// Money is BigInt cents inside the app, and BigInt throws on JSON.stringify. So every API
// response runs through here at the boundary: a BigInt becomes a decimal cent string and the
// client formats money from that string. BIGINT columns already read back from pg as decimal
// strings, so a money value is a decimal cent string either way, which keeps the boundary
// consistent. Dates become ISO strings so timestamps cross as strings too.

export type JsonSafe<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

export function toJsonSafe<T>(value: T): JsonSafe<T> {
  if (typeof value === "bigint") {
    return value.toString() as JsonSafe<T>;
  }
  if (value instanceof Date) {
    return value.toISOString() as JsonSafe<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item)) as JsonSafe<T>;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonSafe(inner);
    }
    return out as JsonSafe<T>;
  }
  return value as JsonSafe<T>;
}
