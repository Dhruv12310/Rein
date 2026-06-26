import { randomUUID, type KeyObject } from "node:crypto";
import type { KeyResolver, MandateBundle } from "../lib/mandates";
import { buildMandateChain, generateKeyPair } from "../lib/signing";

// The signers for one test: a principal, a vendor, and the agent (keyed by the DB agent id). The
// resolver maps each id to its public key, which is exactly what the verifier looks up. Every
// test makes its own actors so keys never collide across tests.
export type Actors = {
  principalId: string;
  vendorId: string;
  agentId: string;
  principalKey: KeyObject;
  vendorKey: KeyObject;
  agentKey: KeyObject;
  resolveKey: KeyResolver;
};

export function makeActors(agentId: string): Actors {
  const principal = generateKeyPair();
  const vendor = generateKeyPair();
  const agent = generateKeyPair();
  const principalId = `principal-${randomUUID()}`;
  const vendorId = `vendor-${randomUUID()}`;
  const keys = new Map<string, KeyObject>([
    [principalId, principal.publicKey],
    [vendorId, vendor.publicKey],
    [agentId, agent.publicKey],
  ]);
  return {
    principalId,
    vendorId,
    agentId,
    principalKey: principal.privateKey,
    vendorKey: vendor.privateKey,
    agentKey: agent.privateKey,
    resolveKey: (id) => keys.get(id),
  };
}

export type BundleOverrides = {
  maxAmountCents?: bigint;
  allowedCategories?: string[];
  vendorAllowlist?: string[];
  notAfter?: Date;
  item?: string;
};

// A fully valid chain for a purchase. By default the scope permits exactly this purchase, so a
// budget test passes the mandate gate and the budget gate is what decides. Overrides push a
// single field out of scope to exercise one mandate rejection at a time.
export function validBundle(
  actors: Actors,
  purchase: { amountCents: bigint; category: string; vendor: string },
  overrides: BundleOverrides = {},
): MandateBundle {
  return buildMandateChain({
    principalKey: actors.principalKey,
    vendorKey: actors.vendorKey,
    agentKey: actors.agentKey,
    principalId: actors.principalId,
    vendorId: actors.vendorId,
    agentId: actors.agentId,
    amountCents: purchase.amountCents,
    category: purchase.category,
    vendor: purchase.vendor,
    item: overrides.item ?? "unit",
    maxAmountCents: overrides.maxAmountCents ?? purchase.amountCents,
    allowedCategories: overrides.allowedCategories ?? [purchase.category],
    vendorAllowlist: overrides.vendorAllowlist ?? [purchase.vendor],
    notAfter: overrides.notAfter ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    nonce: randomUUID(),
  });
}
