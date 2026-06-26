import { createHash } from "node:crypto";

// One canonicalizer, used for both signing and verifying. If signing and verifying ever
// produced different bytes for the same content, every signature would fail silently, so the
// rule here is strict determinism: object keys sorted, no insignificant whitespace, arrays kept
// in order, strings escaped by JSON.stringify. Mandate content carries only strings and arrays
// of strings (amounts and timestamps are strings, never floats), which removes the number and
// precision pitfalls a general canonicalizer has to worry about.
export function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const type = typeof value;
  if (type === "string") {
    return JSON.stringify(value);
  }
  if (type === "boolean") {
    return value ? "true" : "false";
  }
  if (type === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("cannot canonicalize a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((element) => canonicalize(element)).join(",") + "]";
  }
  if (type === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort();
    const body = entries
      .map((key) => JSON.stringify(key) + ":" + canonicalize((value as Record<string, unknown>)[key]))
      .join(",");
    return "{" + body + "}";
  }
  // bigint, undefined, function, and symbol have no deterministic place in signed content.
  // Failing loudly here beats signing something that cannot be reproduced on verify.
  throw new Error(`cannot canonicalize value of type ${type}`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// The content hash that links the mandate chain: sha256 over the canonical form of the content.
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
