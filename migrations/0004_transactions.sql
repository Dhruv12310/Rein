-- One row per purchase decision, approved or blocked. reason carries the explanation a
-- finance reviewer reads, for example "over budget" or "category not allowed".
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_mandate_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  category TEXT,
  vendor TEXT,
  status TEXT NOT NULL,             -- approved or blocked
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
