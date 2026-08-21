-- ===========================================================================
-- D1 Migration 0001: Initial schema mirroring Supabase tables
-- ---------------------------------------------------------------------------
-- Source: github.com/Debrupos7/without-sybil-transfer
-- Target: Cloudflare D1 (SQLite-compatible)
--
-- Notes on Supabase -> D1 translation:
--   * UUID PKs -> TEXT (we generate uuid v4 in app code; SQLite has no native uuid)
--   * TIMESTAMPTZ -> TEXT (ISO 8601 strings; we store UTC)
--   * JSONB -> TEXT (we store JSON strings; validate in app layer)
--   * BOOLEAN -> INTEGER (0/1)
--   * REFERENCES auth.users(id) -> TEXT user_id, validated in app layer
--     (D1 has no equivalent of Supabase auth, so we verify Supabase JWTs
--      in the Worker and use the sub claim as user_id)
--   * gen_random_uuid() -> not available; we use lower(hex(randomblob(16)))
--     formatted as a UUID v4 string in the application code
--   * RLS policies -> enforced in the Worker (every query is scoped by
--     the authenticated user_id from the verified JWT)
-- ===========================================================================

-- Enable foreign keys (D1 supports PRAGMA foreign_keys = ON per-connection)
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- users (mirror of auth.users that we need to look up email <-> user_id)
-- ---------------------------------------------------------------------------
-- We don't store passwords here. We store a lookup from supabase user_id -> email
-- so that "show transaction history for the email of the logged-in user"
-- works regardless of which wallet is connected. THIS IS THE BUG FIX.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                          -- supabase user id (sub claim in JWT)
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,   -- 0/1
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------------------------------------------------------------------------
-- default_networks (public, read-only for everyone; write only via admin)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS default_networks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  rpc_url TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  is_testnet INTEGER NOT NULL DEFAULT 0,        -- 0/1
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_default_networks_chain_id ON default_networks(chain_id);

-- ---------------------------------------------------------------------------
-- user_networks (per-user custom networks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_networks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  rpc_url TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  is_testnet INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_networks_user_id ON user_networks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_networks_chain_id ON user_networks(chain_id);

-- ---------------------------------------------------------------------------
-- user_contracts (per-user saved contracts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_contracts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  network_id TEXT NOT NULL,                    -- may reference user_networks or default_networks
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_contracts_user_id ON user_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_network_id ON user_contracts(network_id);

-- ---------------------------------------------------------------------------
-- user_wallets (one user -> many wallets; THIS enables the email-based history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,                       -- always lowercase
  name TEXT,
  is_whitelisted INTEGER NOT NULL DEFAULT 0,
  last_connected TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(user_id, address),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(address);

-- ---------------------------------------------------------------------------
-- contracts (deployed main contracts; address unique per network)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  address TEXT NOT NULL,
  owner TEXT,                                  -- wallet address (lowercase) or user_id
  deployed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(network_id, address)
);

CREATE INDEX IF NOT EXISTS idx_contracts_network_id ON contracts(network_id);
CREATE INDEX IF NOT EXISTS idx_contracts_address ON contracts(address);

-- ---------------------------------------------------------------------------
-- transactions (the core table; the bug is here)
-- ---------------------------------------------------------------------------
-- ORIGINAL BUG: in TransferForm.tsx line 507 we have:
--   user_id: user?.id || account || ''
-- which means when user.id is missing the code falls back to the *wallet* address,
-- then transactions page queries `.eq('user_id', user.id)`. So when a user
-- switches wallets, their previous transactions (saved with the wallet as user_id)
-- disappear.
--
-- FIX: in the Worker, we ALWAYS require a verified JWT, ALWAYS use the JWT sub
-- as user_id, and reject any insert that doesn't have a valid user_id. We also
-- store wallet_address separately, so /history can be queried by EITHER
-- user_id (preferred) OR wallet_address (for "which transactions did this
-- wallet sign"). The /history endpoint always returns rows scoped to the
-- authenticated user's user_id, regardless of which wallet they connect.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,                       -- ALWAYS the JWT sub, never the wallet
  wallet_address TEXT,                        -- the wallet that signed (lowercase)
  network_id TEXT NOT NULL,
  contract_id TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','failed')),
  amount TEXT NOT NULL,                       -- wei as decimal string to avoid float loss
  recipients TEXT,                             -- JSON array of addresses
  child_contracts TEXT,                        -- JSON array of addresses (nullable)
  gas_cost TEXT,                               -- ether as decimal string (nullable)
  error TEXT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_address ON transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_network_id ON transactions(network_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);

-- ---------------------------------------------------------------------------
-- wallet_groups (user-defined groups of wallets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wallet_groups_user_id ON wallet_groups(user_id);

-- ---------------------------------------------------------------------------
-- wallet_group_members (join table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(group_id, wallet_id),
  FOREIGN KEY (group_id) REFERENCES wallet_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (wallet_id) REFERENCES user_wallets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wallet_group_members_group_id ON wallet_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_wallet_group_members_wallet_id ON wallet_group_members(wallet_id);

-- ---------------------------------------------------------------------------
-- audit_log (security: every authenticated write is logged)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id TEXT,
  ip TEXT,
  method TEXT,
  path TEXT,
  status INTEGER,
  body_hash TEXT                               -- sha256 of request body, for forensics
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);

-- ---------------------------------------------------------------------------
-- rate_limit (per-IP + per-user sliding window counters)
-- ---------------------------------------------------------------------------
-- We use a simple bucket approach. Cleanup is lazy (on read).
CREATE TABLE IF NOT EXISTS rate_limit (
  key TEXT PRIMARY KEY,                        -- "ip:<addr>" or "user:<id>"
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ===========================================================================
-- End of migration 0001
-- ===========================================================================
