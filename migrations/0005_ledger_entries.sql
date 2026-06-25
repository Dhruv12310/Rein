-- Two balanced rows per approved transaction, one debit and one credit, kept for the audit
-- trail. The budget counter is the concurrency control point, this table is the record.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  account TEXT NOT NULL,            -- budget or expense
  direction TEXT NOT NULL,         -- debit or credit
  amount_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
