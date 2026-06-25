-- The AP2 chain: intent, then cart, then payment. parent_mandate_id links a mandate to the
-- one it extends. content_hash and signature make the chain tamper-evident on verification.
CREATE TABLE IF NOT EXISTS mandates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  type TEXT NOT NULL,                -- intent, cart, or payment
  parent_mandate_id UUID,           -- chains intent to cart to payment
  scope JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
