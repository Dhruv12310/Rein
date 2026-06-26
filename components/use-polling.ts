"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PollStatus = "loading" | "ok" | "error";

export type Poll<T> = {
  status: PollStatus;
  data: T | null;
  error: string | null;
  refresh: () => void;
};

// Live data the simple way: fetch on mount, then reschedule the next fetch only AFTER the current
// one settles. A recursive setTimeout, not setInterval, so a slow response never lets requests
// stack up and exhaust the small DSQL pool. No websockets and no browser storage, so the app
// stays stateless and this works on Vercel. The last good data stays on screen through a
// transient error, and after an error the next tick still runs, so a blip recovers on its own.
// Pass intervalMs of 0 for a one-shot load, used by the audit view whose chain never changes.
export function usePolling<T>(url: string, intervalMs = 4000): Poll<T> {
  const [status, setStatus] = useState<PollStatus>("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        // A 404 means the resource does not exist, which is a normal empty result, not an error.
        // The view shows its own not-found state rather than a red failure with a retry button.
        if (response.status === 404) {
          if (!cancelled) {
            setData(null);
            setStatus("ok");
            setError(null);
          }
        } else if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed with ${response.status}`);
        } else {
          const payload = (await response.json()) as T;
          if (!cancelled) {
            setData(payload);
            setStatus("ok");
            setError(null);
          }
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError(err instanceof Error ? err.message : "Request failed");
        setStatus("error");
      }
      if (!cancelled && intervalMs > 0) {
        timer = setTimeout(tick, intervalMs);
      }
    }

    refreshRef.current = () => {
      if (timer) {
        clearTimeout(timer);
      }
      void tick();
    };
    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [url, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { status, data, error, refresh };
}
