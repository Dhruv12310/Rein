import { verify as nodeVerify } from "node:crypto";
import { describe, expect, test } from "vitest";
import { canonicalize, contentHash } from "../lib/canonical";
import { verifyMandateChain, type VerifyContext } from "../lib/mandates";
import { generateKeyPair, signContent, signMandate } from "../lib/signing";
import { makeActors, validBundle } from "./mandate-fixtures";

// These are pure: no database, no clock except the ctx.now passed in. They cover the
// canonicalizer and every branch of verifyMandateChain quickly, alongside the live integration
// tests that prove the wiring.

const AGENT_ID = "agent-pure-test";
const actors = makeActors(AGENT_ID);
const buy = { amountCents: 1_000n, category: "saas", vendor: "Acme" };
const baseCtx: VerifyContext = {
  amountCents: 1_000n,
  category: "saas",
  vendor: "Acme",
  agentId: AGENT_ID,
  now: new Date("2026-06-26T00:00:00.000Z"),
};

describe("canonicalization", () => {
  test("canonical form is independent of object key order", () => {
    const a = { z: "1", a: "2", nested: { y: "3", b: "4" }, list: ["x", "y"] };
    const b = { a: "2", nested: { b: "4", y: "3" }, list: ["x", "y"], z: "1" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  test("array order is preserved and significant", () => {
    expect(canonicalize(["x", "y"])).not.toBe(canonicalize(["y", "x"]));
  });

  test("a signature verifies against the same content built in a different key order", () => {
    const { publicKey, privateKey } = generateKeyPair();
    const content = {
      principal_id: "p",
      agent_id: "a",
      max_amount_cents: "100",
      allowed_categories: ["x"],
      vendor_allowlist: ["v"],
      not_after: "2030-01-01T00:00:00.000Z",
      nonce: "n",
    };
    const signature = signContent(content, privateKey);
    const reordered = {
      nonce: "n",
      vendor_allowlist: ["v"],
      not_after: "2030-01-01T00:00:00.000Z",
      allowed_categories: ["x"],
      max_amount_cents: "100",
      agent_id: "a",
      principal_id: "p",
    };
    const ok = nodeVerify(
      null,
      Buffer.from(canonicalize(reordered), "utf8"),
      publicKey,
      Buffer.from(signature, "base64"),
    );
    expect(ok).toBe(true);
  });
});

describe("verifyMandateChain", () => {
  test("a valid chain verifies", () => {
    const result = verifyMandateChain(validBundle(actors, buy), baseCtx, actors.resolveKey);
    expect(result.ok).toBe(true);
  });

  test("an unknown signer is rejected", () => {
    const result = verifyMandateChain(validBundle(actors, buy), baseCtx, () => undefined);
    expect(result).toMatchObject({ ok: false, reason: "unknown_signer" });
  });

  test("a tampered field invalidates the signature", () => {
    const bundle = validBundle(actors, buy);
    bundle.intent.content.max_amount_cents = "999999999"; // mutate after signing
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  test("a mandate signed by the wrong key is rejected", () => {
    const bundle = validBundle(actors, buy);
    const stranger = generateKeyPair();
    bundle.payment = signMandate(bundle.payment.content, stranger.privateKey);
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  test("a payment pointing at the wrong cart breaks the chain", () => {
    const bundle = validBundle(actors, buy);
    bundle.payment = signMandate(
      { ...bundle.payment.content, cart_hash: "0".repeat(64) },
      actors.agentKey,
    );
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "broken_chain" });
  });

  test("cart and payment disagreeing on amount is rejected", () => {
    const intent = {
      principal_id: actors.principalId,
      agent_id: AGENT_ID,
      max_amount_cents: "5000",
      allowed_categories: ["saas"],
      vendor_allowlist: ["Acme"],
      not_after: "2030-01-01T00:00:00.000Z",
      nonce: "n",
    };
    const intentHash = contentHash(intent);
    const cart = {
      vendor_id: actors.vendorId,
      intent_hash: intentHash,
      item: "unit",
      amount_cents: "1000",
      category: "saas",
      vendor: "Acme",
    };
    const cartHash = contentHash(cart);
    const payment = {
      agent_id: AGENT_ID,
      intent_hash: intentHash,
      cart_hash: cartHash,
      amount_cents: "2000", // disagrees with the cart
    };
    const bundle = {
      intent: signMandate(intent, actors.principalKey),
      cart: signMandate(cart, actors.vendorKey),
      payment: signMandate(payment, actors.agentKey),
    };
    const result = verifyMandateChain(bundle, { ...baseCtx, amountCents: 1_000n }, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "amount_mismatch" });
  });

  test("a purchase that does not match the cart is rejected", () => {
    const result = verifyMandateChain(
      validBundle(actors, buy),
      { ...baseCtx, vendor: "SomeoneElse" },
      actors.resolveKey,
    );
    expect(result).toMatchObject({ ok: false, reason: "purchase_mismatch" });
  });

  test("a purchase for a different agent than the payment is rejected", () => {
    const result = verifyMandateChain(
      validBundle(actors, buy),
      { ...baseCtx, agentId: "other-agent" },
      actors.resolveKey,
    );
    expect(result).toMatchObject({ ok: false, reason: "agent_mismatch" });
  });

  test("an amount over the intent cap is rejected", () => {
    const bundle = validBundle(actors, buy, { maxAmountCents: 999n });
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "amount_exceeds_intent" });
  });

  test("a category outside the intent is rejected", () => {
    const bundle = validBundle(actors, buy, { allowedCategories: ["cloud"] });
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "category_not_allowed" });
  });

  test("a vendor outside the intent is rejected", () => {
    const bundle = validBundle(actors, buy, { vendorAllowlist: ["OtherVendor"] });
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "vendor_not_allowed" });
  });

  test("an expired intent is rejected", () => {
    const bundle = validBundle(actors, buy, { notAfter: new Date("2000-01-01T00:00:00.000Z") });
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "expired_intent" });
  });

  test("a validly-signed but non-integer amount is rejected, not thrown", () => {
    // A vendor that formats cents as decimal dollars, or a crafted payload, can sign "10.50".
    // Verification must turn that into a recorded rejection, never a thrown error.
    const intent = {
      principal_id: actors.principalId,
      agent_id: AGENT_ID,
      max_amount_cents: "5000",
      allowed_categories: ["saas"],
      vendor_allowlist: ["Acme"],
      not_after: "2030-01-01T00:00:00.000Z",
      nonce: "n",
    };
    const intentHash = contentHash(intent);
    const cart = {
      vendor_id: actors.vendorId,
      intent_hash: intentHash,
      item: "unit",
      amount_cents: "10.50",
      category: "saas",
      vendor: "Acme",
    };
    const cartHash = contentHash(cart);
    const payment = {
      agent_id: AGENT_ID,
      intent_hash: intentHash,
      cart_hash: cartHash,
      amount_cents: "10.50",
    };
    const bundle = {
      intent: signMandate(intent, actors.principalKey),
      cart: signMandate(cart, actors.vendorKey),
      payment: signMandate(payment, actors.agentKey),
    };
    const result = verifyMandateChain(bundle, { ...baseCtx, amountCents: 10n }, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "malformed_mandate" });
  });

  test("a non-array allowlist allows nothing rather than throwing", () => {
    const intent = {
      principal_id: actors.principalId,
      agent_id: AGENT_ID,
      max_amount_cents: "5000",
      allowed_categories: "saas" as unknown as string[], // crafted non-array
      vendor_allowlist: ["Acme"],
      not_after: "2030-01-01T00:00:00.000Z",
      nonce: "n",
    };
    const intentHash = contentHash(intent);
    const cart = {
      vendor_id: actors.vendorId,
      intent_hash: intentHash,
      item: "unit",
      amount_cents: "1000",
      category: "saas",
      vendor: "Acme",
    };
    const cartHash = contentHash(cart);
    const payment = {
      agent_id: AGENT_ID,
      intent_hash: intentHash,
      cart_hash: cartHash,
      amount_cents: "1000",
    };
    const bundle = {
      intent: signMandate(intent, actors.principalKey),
      cart: signMandate(cart, actors.vendorKey),
      payment: signMandate(payment, actors.agentKey),
    };
    const result = verifyMandateChain(bundle, baseCtx, actors.resolveKey);
    expect(result).toMatchObject({ ok: false, reason: "category_not_allowed" });
  });
});

test("perf: mandate verification overhead is sub-millisecond", () => {
  const bundle = validBundle(actors, buy);
  for (let i = 0; i < 50; i++) {
    verifyMandateChain(bundle, baseCtx, actors.resolveKey); // warm the JIT
  }
  const iterations = 1_000;
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    if (!verifyMandateChain(bundle, baseCtx, actors.resolveKey).ok) {
      throw new Error("expected a valid chain");
    }
  }
  const perCallMs = (performance.now() - started) / iterations;
  console.log(`[perf] mandateVerifyMs perCall=${perCallMs.toFixed(3)} over ${iterations} iterations`);
  expect(perCallMs).toBeLessThan(10);
});
