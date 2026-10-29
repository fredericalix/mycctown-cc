-- Users who have authenticated via Clever Cloud OAuth
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cc_user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    name VARCHAR(255),
    oauth_token_enc BYTEA NOT NULL,
    oauth_secret_enc BYTEA NOT NULL,
    oauth_nonce BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_cc_user_id ON users(cc_user_id);

-- Local cache of Clever Cloud organisations the user belongs to
CREATE TABLE IF NOT EXISTS organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    avatar_url TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, cc_org_id)
);

CREATE INDEX IF NOT EXISTS idx_orgs_user ON organisations(user_id);

-- One map per (user, org). Cells serialized as JSONB by the frontend.
CREATE TABLE IF NOT EXISTS maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'My City',
    cells_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, cc_org_id)
);

CREATE INDEX IF NOT EXISTS idx_maps_user_org ON maps(user_id, cc_org_id);

-- Denormalized app/addon -> hex coord + asset mapping, for fast lookup by WS poller
CREATE TABLE IF NOT EXISTS asset_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id VARCHAR(255) NOT NULL,
    cc_resource_id VARCHAR(255) NOT NULL,
    resource_kind VARCHAR(16) NOT NULL CHECK (resource_kind IN ('app', 'addon')),
    hex_q INT NOT NULL,
    hex_r INT NOT NULL,
    asset_id VARCHAR(128) NOT NULL,
    rotation SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, cc_org_id, cc_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_mappings_org ON asset_mappings(user_id, cc_org_id);
CREATE INDEX IF NOT EXISTS idx_mappings_resource ON asset_mappings(cc_resource_id);

-- Cached Warp10 tokens per organization
CREATE TABLE IF NOT EXISTS warp10_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cc_org_id VARCHAR(255) NOT NULL,
    token_enc BYTEA NOT NULL,
    token_nonce BYTEA NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_warp10_tokens_org ON warp10_tokens(cc_org_id);
CREATE INDEX IF NOT EXISTS idx_warp10_tokens_expiry ON warp10_tokens(expires_at);
