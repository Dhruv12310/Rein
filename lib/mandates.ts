import { verify as verifySignatureRaw, type KeyObject } from "node:crypto";
import { canonicalize, contentHash } from "./canonical";

// The three signed objects of the AP2 chain. Amounts are decimal cent strings, not numbers, so
// the canonical form stays exact and float free. Timestamps are ISO 8601 strings.
export type IntentContent = {
  principal_id: string;
  agent_id: string;
  max_amount_cents: string;
  allowed_categories: string[];
  vendor_allowlist: string[];
  not_after: string;
  nonce: string;
};

export type CartContent = {
  vendor_id: string;
  intent_hash: string;
  item: string;
  amount_cents: string;
  category: string;
  vendor: string;
};

export type PaymentContent = {
  agent_id: string;
  intent_hash: string;
  cart_hash: string;
  amount_cents: string;
};

// A mandate as it travels: the signed content plus its detached Ed25519 signature (base64).
// The signer's identity is read from the content (principal_id, vendor_id, agent_id), which is
// also how the verifier looks up the right public key.
export type SignedMandate<T> = {
  content: T;
  signature: string;
};

export type MandateBundle = {
  intent: SignedMandate<IntentContent>;
  cart: SignedMandate<CartContent>;
  payment: SignedMandate<PaymentContent>;
};

// Looks up a signer's public key by id, or returns undefined if the signer is unknown.
export type KeyResolver = (signerId: string) => KeyObject | undefined;

// Machine-readable rejection reasons, one per gate, so the audit trail shows exactly which
// check stopped a purchase. These stay distinct from the Phase 1 budget reasons.
export type MandateRejectReason =
  | "unknown_signer"
  | "invalid_signature"
  | "broken_chain"
  | "malformed_mandate"
  | "amount_mismatch"
  | "purchase_mismatch"
  | "agent_mismatch"
  | "amount_exceeds_intent"
  | "category_not_allowed"
  | "vendor_not_allowed"
  | "expired_intent";

export type VerifyContext = {
  amountCents: bigint;
  category: string;
  vendor: string;
  agentId: string;
  now?: Date;
};

export type VerifyResult =
  | { ok: true; intentHash: string; cartHash: string; paymentHash: string }
  | { ok: false; reason: MandateRejectReason };

function reject(reason: MandateRejectReason): VerifyResult {
  return { ok: false, reason };
}

// Amounts arrive as signer-controlled strings, so parse them to non-negative integer cents
// explicitly. BigInt is too lenient to trust here: BigInt("") is 0, BigInt(" 5") is 5, and
// BigInt("0x10") is 16, so a strict decimal check is what actually rejects bad input. Returns
// null on anything that is not a plain decimal integer, which the caller turns into a rejection.
function parseCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return BigInt(value);
}

// crypto.verify returns false for a wrong signature but throws on a malformed key or signature,
// so a bad input is a rejection, not a crash.
function signatureValid(content: unknown, signature: string, key: KeyObject): boolean {
  try {
    return verifySignatureRaw(
      null,
      Buffer.from(canonicalize(content), "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

// Pure verification of the Intent, Cart, Payment chain. No database, no time except the caller's
// `now`, so the same inputs always give the same result. A failure here is a deterministic
// business rejection, never a transient error, which is why the purchase path treats it as a
// recorded block and never as an OCC retry.
export function verifyMandateChain(
  bundle: MandateBundle,
  ctx: VerifyContext,
  resolveKey: KeyResolver,
): VerifyResult {
  const { intent, cart, payment } = bundle;
  const now = ctx.now ?? new Date();

  // 1. Signatures, each against the correct key: principal for intent, vendor for cart, agent
  // for payment.
  const intentKey = resolveKey(intent.content.principal_id);
  const cartKey = resolveKey(cart.content.vendor_id);
  const paymentKey = resolveKey(payment.content.agent_id);
  if (!intentKey || !cartKey || !paymentKey) {
    return reject("unknown_signer");
  }
  if (
    !signatureValid(intent.content, intent.signature, intentKey) ||
    !signatureValid(cart.content, cart.signature, cartKey) ||
    !signatureValid(payment.content, payment.signature, paymentKey)
  ) {
    return reject("invalid_signature");
  }

  // 2. Chain hashes: the cart and payment must reference the real intent, and the payment must
  // reference the real cart. Recompute from the content rather than trusting the carried hash.
  const intentHash = contentHash(intent.content);
  const cartHash = contentHash(cart.content);
  const paymentHash = contentHash(payment.content);
  if (
    cart.content.intent_hash !== intentHash ||
    payment.content.intent_hash !== intentHash ||
    payment.content.cart_hash !== cartHash
  ) {
    return reject("broken_chain");
  }

  // 3. Cart and payment agree on amount, and the purchase being charged matches the cart. The
  // amounts are signer-controlled strings, so parse them to integer cents first and compare as
  // BigInt. A malformed amount is a deterministic rejection, never a thrown error, which keeps
  // this function total so the purchase path always records a block instead of crashing.
  const cartAmount = parseCents(cart.content.amount_cents);
  const paymentAmount = parseCents(payment.content.amount_cents);
  const maxAmount = parseCents(intent.content.max_amount_cents);
  if (cartAmount === null || paymentAmount === null || maxAmount === null) {
    return reject("malformed_mandate");
  }
  if (cartAmount !== paymentAmount) {
    return reject("amount_mismatch");
  }
  if (
    cartAmount !== ctx.amountCents ||
    cart.content.category !== ctx.category ||
    cart.content.vendor !== ctx.vendor
  ) {
    return reject("purchase_mismatch");
  }
  if (payment.content.agent_id !== ctx.agentId || intent.content.agent_id !== ctx.agentId) {
    return reject("agent_mismatch");
  }

  // 4. Scope from the intent: amount within the cap, category and vendor allowed, not expired.
  // The allowlists are signer-controlled too, so a non-array allows nothing rather than throwing.
  if (paymentAmount > maxAmount) {
    return reject("amount_exceeds_intent");
  }
  if (
    !Array.isArray(intent.content.allowed_categories) ||
    !intent.content.allowed_categories.includes(cart.content.category)
  ) {
    return reject("category_not_allowed");
  }
  if (
    !Array.isArray(intent.content.vendor_allowlist) ||
    !intent.content.vendor_allowlist.includes(cart.content.vendor)
  ) {
    return reject("vendor_not_allowed");
  }
  const notAfter = Date.parse(intent.content.not_after);
  if (Number.isNaN(notAfter) || now.getTime() > notAfter) {
    return reject("expired_intent");
  }

  return { ok: true, intentHash, cartHash, paymentHash };
}
