-- Records every transaction the demo agent produces, so the demo reset can clear demo-scoped
-- transactions, ledger entries, and redeemed payments cleanly. Transactions carry no agent id and
-- a blocked transaction has no linked mandate, so tracking the ids here is the one way to find
-- them all later, including the blocked ones, without touching any non-demo data.
CREATE TABLE IF NOT EXISTS demo_transactions (
  transaction_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);
