import {
  createPublicKey,
  generateKeyPairSync,
  sign as signRaw,
  type KeyObject,
} from "node:crypto";
import { canonicalize, contentHash } from "./canonical";
import type {
  CartContent,
  IntentContent,
  MandateBundle,
  PaymentContent,
  SignedMandate,
} from "./mandates";

// Signing lives apart from verification on purpose: the server only ever verifies. These
// utilities hold private keys and are used by tests and, later, the demo agent to produce
// signed mandates. Nothing in the request path imports this module.

export type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };

export function generateKeyPair(): KeyPair {
  return generateKeyPairSync("ed25519");
}

// Sign the canonical form of the content. Ed25519 carries its own hash, so the algorithm
// argument is null. The signature is returned base64 to travel as a string.
export function signContent(content: unknown, privateKey: KeyObject): string {
  return signRaw(null, Buffer.from(canonicalize(content), "utf8"), privateKey).toString("base64");
}

export function signMandate<T>(content: T, privateKey: KeyObject): SignedMandate<T> {
  return { content, signature: signContent(content, privateKey) };
}

// Export and re-import a public key as base64 DER, the form a key registry or a demo seed can
// store as text and the verifier can turn back into a KeyObject.
export function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export function importPublicKey(base64Der: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64Der, "base64"), type: "spki", format: "der" });
}

// Build and sign a complete, valid chain. The hashes are computed with the same canonicalizer
// the verifier uses, so a chain built here verifies there. Tests start from this and tamper a
// single field to exercise each rejection.
export function buildMandateChain(params: {
  principalKey: KeyObject;
  vendorKey: KeyObject;
  agentKey: KeyObject;
  principalId: string;
  vendorId: string;
  agentId: string;
  amountCents: bigint;
  category: string;
  vendor: string;
  item: string;
  maxAmountCents: bigint;
  allowedCategories: string[];
  vendorAllowlist: string[];
  notAfter: Date;
  nonce: string;
}): MandateBundle {
  const intent: IntentContent = {
    principal_id: params.principalId,
    agent_id: params.agentId,
    max_amount_cents: params.maxAmountCents.toString(),
    allowed_categories: params.allowedCategories,
    vendor_allowlist: params.vendorAllowlist,
    not_after: params.notAfter.toISOString(),
    nonce: params.nonce,
  };
  const intentHash = contentHash(intent);

  const cart: CartContent = {
    vendor_id: params.vendorId,
    intent_hash: intentHash,
    item: params.item,
    amount_cents: params.amountCents.toString(),
    category: params.category,
    vendor: params.vendor,
  };
  const cartHash = contentHash(cart);

  const payment: PaymentContent = {
    agent_id: params.agentId,
    intent_hash: intentHash,
    cart_hash: cartHash,
    amount_cents: params.amountCents.toString(),
  };

  return {
    intent: signMandate(intent, params.principalKey),
    cart: signMandate(cart, params.vendorKey),
    payment: signMandate(payment, params.agentKey),
  };
}
