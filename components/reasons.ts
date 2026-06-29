// The machine reasons stay in the data. Here they become the words a finance reviewer reads, and
// a group that decides the color, so the surface that blocked a purchase (budget, mandate, or the
// single-use gate) is legible at a glance. That distinction is the product's value.

export type ReasonGroup = "approved" | "budget" | "mandate" | "replay";

const MANDATE_LABELS: Record<string, string> = {
  unknown_signer: "Unknown signer",
  invalid_signature: "Invalid signature",
  broken_chain: "Broken mandate chain",
  malformed_mandate: "Malformed mandate",
  amount_mismatch: "Cart and payment disagree",
  purchase_mismatch: "Does not match the cart",
  agent_mismatch: "Wrong agent",
  amount_exceeds_intent: "Over the authorized amount",
  category_not_allowed: "Category not authorized",
  vendor_not_allowed: "Vendor not authorized",
  expired_intent: "Authorization expired",
};

export type DescribedReason = {
  label: string;
  group: ReasonGroup;
  machine: string | null;
};

export function describeReason(status: string, reason: string | null): DescribedReason {
  if (status === "approved") {
    return { label: "Approved", group: "approved", machine: null };
  }
  if (!reason) {
    return { label: "Blocked", group: "mandate", machine: null };
  }
  if (reason === "payment_already_redeemed") {
    return { label: "Already charged", group: "replay", machine: reason };
  }
  if (reason === "agent_revoked") {
    return { label: "Agent revoked", group: "mandate", machine: reason };
  }
  if (MANDATE_LABELS[reason]) {
    return { label: MANDATE_LABELS[reason], group: "mandate", machine: reason };
  }
  if (/^amount exceeds remaining/.test(reason)) {
    return { label: "Over budget", group: "budget", machine: reason };
  }
  if (/^no budget covers/.test(reason)) {
    return { label: "No budget set", group: "budget", machine: reason };
  }
  return { label: reason, group: "mandate", machine: reason };
}
