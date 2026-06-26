"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LiveDot } from "./ui";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/budgets", label: "Budgets" },
  { href: "/activity", label: "Activity" },
  { href: "/demo", label: "Demo" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
        <div className="flex items-center gap-6 sm:gap-8">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">Rein</span>
            <span className="hidden text-xs text-faint sm:inline">spending control for agents</span>
          </Link>
          <nav className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active =
                tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <LiveDot />
      </div>
    </header>
  );
}
