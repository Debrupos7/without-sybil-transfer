# Sybil Transfer Worker + D1

A Cloudflare Worker + D1 backend that replaces Supabase for the
[without-sybil-transfer](https://github.com/Debrupos7/without-sybil-transfer)
web3 app. Built with **top-level security**:

- 🔐 Every request requires a verified **Supabase JWT** (HS256 with RS256/JWKS fallback).
- 🛡️ Every D1 query is scoped by the JWT `sub` (user_id). This is the
  **Cloudflare-equivalent of Supabase RLS** — D1 has no native RLS, so we
  enforce it in the Worker.
- 🚦 Per-IP **and** per-user **rate limiting** (D1-backed sliding window).
- 🎯 **Zod** input validation on every POST/PUT body.
- 🔒 Strict **CORS** (origin allowlist, no wildcard).
- 🧱 Strict **security headers** (CSP `default-src 'none'`, HSTS, XFO, nosniff, referrer-policy).
- 📒 **Audit log** of every authenticated request (method, path, status, body hash).
- 🐛 **Bug fix**: transaction history is now keyed by the authenticated
  user_id (from the JWT), NOT by the connected wallet. Switching wallets no
  longer makes old transactions disappear.
- 💾 Supabase is **left untouched** as a backup. Migration is read-only on
  Supabase, idempotent on D1.

---

## Folder structure

```
worker-database/
├── migrations/
│   └── 0001_init.sql          # D1 schema mirroring all Supabase tables
├── src/
│   ├── index.ts               # Hono app, auth + rate limit + audit middleware
│   ├── auth.ts                # Supabase JWT verification (HS256 + RS256/JWKS)
│   ├── security.ts             # CORS, rate limit, Zod schemas, helpers
│   └── routes/
│       ├── transactions.ts    # CRUD for transactions (user_id forced from JWT)
│       ├── networks.ts        # GET default + user networks
│       ├── user-networks.ts   # CRUD for user's custom networks
│       ├── user-contracts.ts  # CRUD for user's saved contracts
│       ├── contracts.ts       # GET/POST deployed main contracts
│       ├── wallets.ts         # CRUD for user_wallets (linking table)
│       ├── wallet-groups.ts   # CRUD + member management
│       ├── history.ts         # 🐛 THE BUG FIX — keyed by user_id, not wallet
│       └── cleanup.ts         # Admin-only cleanup of old transactions
├── scripts/
│   └── migrate-supabase-to-d1.mjs   # Read-only Supabase -> D1 migration
├── test/
│   ├── worker.test.ts         # Vitest suite
│   └── setup.ts               # Auto-applies migration before tests
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions: typecheck -> test -> migrate -> deploy
├── wrangler.toml              # Cloudflare Worker config
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .dev.vars.example          # Copy to .dev.vars and fill in locally
└── .gitignore                 # Ensures .dev.vars / .env / node_modules are never committed
```

---

## Quick start (local dev)

```bash
cd worker-database
cp .dev.vars.example .dev.vars
# Edit .dev.vars: fill in SUPABASE_JWT_SECRET, ALLOWED_ORIGINS=http://localhost:3000
npm install
npm run migrate:local      # apply schema to local D1
npm run dev               # start worker at http://localhost:8787
```

Test the health check:
```bash
curl http://localhost:8787/healthz
# {"ok":true,"ts":"2025-...","env":"development"}
```

---

## Deploying to production

Run these commands yourself on your local machine. **Never paste your
Cloudflare API token into a chat, an LLM, or a file that gets committed.**

### 1. Rotate all secrets first
- Supabase: rotate the service-role key AND the JWT secret.
  Dashboard → Project Settings → API → "Rotate keys".
- GitHub: revoke any PAT you've shared; create a fresh one with only
  `repo` scope for this project.
- Cloudflare: revoke any API token you've shared; create a fresh one with
  permissions: `Workers Scripts:Edit`, `D1:Edit`, `Account:Read`.

### 2. Create the D1 database

```bash
cd worker-database
npx wrangler login              # opens browser, no token in code
npx wrangler d1 create sybil-transfer-db
# Copy the printed `database_id` into wrangler.toml [[d1_databases]] section.
```

### 3. Apply the schema to remote D1

```bash
npm run migrate:remote
```

### 4. Set the Worker secrets

```bash
npm run secret:jwt           # pastes SUPABASE_JWT_SECRET (you'll be prompted)
npm run secret:cleanup       # pastes CLEANUP_API_KEY (generate with: openssl rand -hex 32)
```

### 5. Update `wrangler.toml` for production

- Set `ALLOWED_ORIGINS` to your deployed frontend origin(s).
- Set `ADMIN_USER_IDS` to your Supabase user id (find in Supabase Dashboard → Auth → Users).

### 6. Deploy

```bash
npm run deploy
```

The Worker URL will be `https://sybil-transfer-worker.<your-subdomain>.workers.dev`.

### 7. (Optional) Wire up GitHub Actions

In your GitHub repo settings, add these **Actions secrets** (not env vars):

| Secret name | Source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Account Home → Account ID |
| `D1_DATABASE_ID` | From step 2 |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret |
| `CLEANUP_API_KEY` | The value you generated in step 4 |

Now every push to `main` that touches `worker-database/**` will automatically
typecheck, test, migrate, and deploy.

---

## Migrating data from Supabase to D1

```bash
# Set these in your shell (or in .dev.vars):
export SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_...your-fresh-service-role-key...
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
export D1_DATABASE_ID=...
export D1_DATABASE_NAME=sybil-transfer-db

# Dry run (counts rows in Supabase, asks for confirmation):
npm run migrate-from-supabase

# Skip the prompt (for CI):
npm run migrate-from-supabase:yes
```

The script:
- **Reads** from Supabase only. Never writes to Supabase.
- **Idempotent** on D1: re-running it won't duplicate rows.
- **Auto-recovers** transactions where the original Supabase code had stored
  a wallet address as `user_id` (the bug). It looks up the real user_id
  from `user_wallets` and fixes the row on insert.

---

## The bug fix (transaction history)

### The original bug

In the Supabase version, `src/components/TransferForm.tsx` line 507 had:

```js
user_id: user?.id || account || ''
```

When `user.id` was undefined (session not yet loaded, race condition,
auth state mismatch), the connected wallet address was stored as
`user_id`. Then `src/app/transactions/page.tsx` line 155 queried
`.eq('user_id', user.id)`, which would miss all rows where `user_id`
had been stored as a wallet address. The user-visible symptom was:

> Switching wallets makes my previous transactions disappear.

### The fix

The Worker:

1. **Requires a verified Supabase JWT** on every authenticated endpoint.
2. **Forces `user_id = JWT.sub`** when inserting transactions — the body's
   `user_id` field is **ignored**.
3. **Stores `wallet_address` separately**, so the row records which wallet
   signed the transaction without making the wallet the access key.
4. **`GET /history`** returns all transactions where `user_id = JWT.sub`,
   regardless of which wallet is currently connected.
5. **`GET /history/by-email`** is an explicit alias that confirms the lookup
   is email-based (email comes from the JWT, never from a query param).
6. **`GET /history/wallets`** returns the distinct wallets that have signed
   transactions for this user — useful for the UI to show "your wallets"
   even if they're not all registered in `user_wallets`.

The migration script also retroactively **fixes historical rows** in
Supabase that had a wallet address as `user_id`: it looks up the real
user_id from `user_wallets` and writes the corrected row to D1.

---

## Endpoint reference

All endpoints (except `/healthz`) require `Authorization: Bearer <supabase-jwt>`.

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | No auth. Liveness probe. |
| GET | `/transactions` | Filter: `?wallet=0x...&network_id=...&status=...` |
| GET | `/transactions/:id` | 404 if not owned by caller |
| POST | `/transactions` | `user_id` is forced from JWT (bug fix) |
| PUT | `/transactions/:id` | 404 if not owned by caller |
| DELETE | `/transactions/:id` | 404 if not owned by caller |
| GET | `/networks` | Default + user networks, organized by mainnet/testnet |
| GET | `/user-networks` | |
| POST | `/user-networks` | |
| PUT | `/user-networks/:id` | |
| DELETE | `/user-networks/:id` | |
| GET | `/user-contracts` | Filter: `?network_id=...` |
| POST | `/user-contracts` | |
| PUT | `/user-contracts/:id` | |
| DELETE | `/user-contracts/:id` | |
| GET | `/contracts` | Public list of deployed main contracts |
| POST | `/contracts` | Upsert by (network_id, address) |
| GET | `/contracts/:network_id/:address` | |
| GET | `/wallets` | List caller's wallets |
| POST | `/wallets` | Upsert by (user_id, address) |
| PUT | `/wallets/:id` | |
| DELETE | `/wallets/:id` | |
| GET | `/wallet-groups` | Includes `members` array |
| POST | `/wallet-groups` | Create with optional `wallet_ids[]` |
| PUT | `/wallet-groups/:id` | Update name and/or replace `wallet_ids[]` |
| DELETE | `/wallet-groups/:id` | Cascades to `wallet_group_members` |
| POST | `/wallet-groups/:id/members` | Body: `{ "wallet_id": "..." }` |
| DELETE | `/wallet-groups/:id/members/:wallet_id` | |
| GET | `/history` | **Bug fix** — all of caller's transactions |
| GET | `/history/by-email` | Alias, confirms email-based lookup |
| GET | `/history/wallets` | Distinct wallets the caller has signed with |
| GET | `/cleanup-transactions` | Admin only — preview what would be deleted |
| POST | `/cleanup-transactions` | Admin only — delete txs older than 7 days |

---

## Frontend integration

In your Next.js app, replace direct Supabase calls with Worker fetch calls.
Example:

```ts
// Before (Supabase):
const { data } = await supabase.from("transactions").select("*").eq("user_id", user.id);

// After (Worker):
const res = await fetch(`${WORKER_URL}/history`, {
  headers: { Authorization: `Bearer ${supabaseSession.access_token}` },
});
const { transactions } = await res.json();
```

The `access_token` from the Supabase session is the JWT the Worker verifies.

---

## Security checklist

- [x] All secrets stored as Cloudflare secrets or GitHub Actions secrets — never in code.
- [x] `.dev.vars` and `.env*` gitignored.
- [x] CORS locked to specific origins.
- [x] JWT verification on every authenticated endpoint.
- [x] Per-user access scoping (RLS equivalent) on every D1 query.
- [x] Input validation via Zod.
- [x] Parameterized SQL queries only (zero string interpolation of user input).
- [x] Rate limiting per IP and per user.
- [x] Audit log of every authenticated request.
- [x] Strict security headers (CSP, HSTS, XFO, nosniff, referrer-policy, permissions-policy).
- [x] `service_role` Supabase key used only by the migration script, never by the Worker.
- [x] Supabase database left untouched by the migration (read-only).
- [x] GitHub PATs and Cloudflare API tokens never committed to the repo.

---

## License

Same as the parent repo (without-sybil-transfer).
