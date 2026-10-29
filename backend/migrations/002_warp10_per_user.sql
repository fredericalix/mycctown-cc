-- Warp10 tokens are per-user: each authenticated user owns their own CC API
-- metrics token, even when they share an organisation. Sharing a single token
-- across users inside the same org is a data-leak: one user could read metrics
-- against another user's CC OAuth tokens via a stale cached row.

-- 1. Drop any tokens currently cached (no data loss: they're just caches).
DELETE FROM warp10_tokens;

-- 2. Add user_id column tying tokens to the CC user who fetched them.
ALTER TABLE warp10_tokens
    ADD COLUMN user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;

-- 3. Enforce one valid token per (user, org) at any time.
CREATE UNIQUE INDEX idx_warp10_tokens_user_org ON warp10_tokens(user_id, cc_org_id);

-- 4. Drop the old org-wide index — keep only the compound one.
DROP INDEX IF EXISTS idx_warp10_tokens_org;
