-- Per-(user, org) CC notification webhook registration.
-- `token` is the opaque secret we embed in the URL CC posts to; it is the
-- only authentication on the receiver, since CC webhooks carry no HMAC.
-- `cc_webhook_id` is the identifier returned by CC on create, needed to
-- delete the webhook later without re-listing.

CREATE TABLE IF NOT EXISTS webhook_configs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id     VARCHAR(255) NOT NULL,
    token         TEXT NOT NULL UNIQUE,
    cc_webhook_id TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, cc_org_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_token ON webhook_configs(token);
