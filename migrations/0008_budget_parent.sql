-- A budget can roll up to a parent cap, so spend cascades org to team to agent to task. A purchase
-- decrements its own budget and every ancestor in the same transaction, which turns a shared parent
-- cap into a single contended row: agents under one team budget collide there, and DSQL serializes
-- them the same way it does a single budget. Null parent means a top-level cap. One DDL statement.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS parent_budget_id UUID;
