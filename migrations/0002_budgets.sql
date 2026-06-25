-- One row per agent, period, and category. remaining_cents is the single value every
-- purchase updates, so concurrent purchases for the same budget collide on this row and
-- optimistic concurrency forces one to retry instead of both overspending.
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,            -- app-enforced reference to agents.id
  period TEXT NOT NULL,              -- example, 2026-06
  category TEXT,                     -- null means an overall cap
  limit_cents BIGINT NOT NULL,
  remaining_cents BIGINT NOT NULL,   -- the concurrency control point
  updated_at TIMESTAMPTZ DEFAULT now()
);
