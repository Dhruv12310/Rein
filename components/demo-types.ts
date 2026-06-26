// The client-facing shapes the demo endpoints return, money as cent strings.

export type DemoScenario =
  | "approved"
  | "wrong-category"
  | "over-budget"
  | "race"
  | "replay"
  | "tampered";

export type DemoRaceResult = {
  approvedCount: number;
  blockedCount: number;
  limitCents: string;
  amountCents: string;
  finalRemainingCents: string;
  loserRetries: number;
  conflictObserved: boolean;
  booksBalanced: boolean;
};

export type DemoRunResult = {
  scenario: DemoScenario;
  title: string;
  status: "approved" | "blocked";
  summary: string;
  machineReason: string | null;
  transactionId: string | null;
  spendBeforeCents: string | null;
  spendAfterCents: string | null;
  race: DemoRaceResult | null;
};
