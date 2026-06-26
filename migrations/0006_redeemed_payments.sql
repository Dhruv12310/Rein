-- One row per redeemed payment mandate. The payment's content_hash is the primary key, so a
-- second redemption of the same payment collides here. That is what makes a payment authorize at
-- most one charge: a concurrent collision surfaces as 40001 at commit and the OCC retry handles
-- it, and a collision with an already-committed redemption surfaces as 23505 and is recorded as a
-- replay block.
CREATE TABLE IF NOT EXISTS redeemed_payments (
  payment_hash TEXT PRIMARY KEY,
  transaction_id UUID NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT now()
);
