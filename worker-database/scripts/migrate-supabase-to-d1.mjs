// ============================================================================
// migrate-supabase-to-d1.mjs
// ----------------------------------------------------------------------------
// Reads all rows from the Supabase tables and writes them into D1.
//
// USAGE (run locally; NEVER run inside the worker):
//   1. Set these env vars in your shell or in .dev.vars (do NOT commit):
//        SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx     # service_role, NOT anon
//        CLOUDFLARE_ACCOUNT_ID=...
//        CLOUDFLARE_API_TOKEN=...
//        D1_DATABASE_ID=...
//        D1_DATABASE_NAME=sybil-transfer-db
//   2. node scripts/migrate-supabase-to-d1.mjs
//
// PROPERTIES:
//   * READ-ONLY on Supabase. It never writes, updates, or deletes from Supabase.
//   * IDEMPOTENT on D1: re-running it won't duplicate rows (uses INSERT OR
//     IGNORE / ON CONFLICT DO NOTHING for the rows that have stable PKs, and
//     for transactions it skips rows whose id already exists).
//   * SAFE: prints a dry-run summary first and asks for confirmation before
//     writing to D1 unless you pass --yes.
//
// REQUIRES Node 18+ (built-in fetch). No dependencies.
// ============================================================================

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadDevVars() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(join(here, "..", ".dev.vars"), "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
      const eq = cleaned.indexOf("=");
      if (eq === -1) continue;
      const key = cleaned.slice(0, eq).trim();
      const value = cleaned.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .dev.vars not found; env vars must be set in shell
  }
}

loadDevVars();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const D1_ID = process.env.D1_DATABASE_ID || "";
const D1_NAME = process.env.D1_DATABASE_NAME || "sybil-transfer-db";
const SKIP_CONFIRM = process.argv.includes("--yes");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.");
  console.error("Set them in your shell. Do NOT hardcode them in this file.");
  process.exit(1);
}
if (!CF_ACCOUNT || !CF_TOKEN || !D1_ID) {
  console.error("ERROR: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and D1_DATABASE_ID are required.");
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Accept: "application/json",
  // Request up to 1000 rows per page; PostgREST default is 1000.
  Range: "0-999",
  "Range-Unit": "items",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Fetch ALL rows from a Supabase table by paginating.
async function fetchAllFromSupabase(tableName, pageSize = 1000) {
  const allRows = [];
  let offset = 0;
  while (true) {
    const headers = {
      ...supabaseHeaders,
      Range: `${offset}-${offset + pageSize - 1}`,
      "Range-Unit": "items",
      Prefer: "count=exact",
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*`, {
      headers,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch ${tableName}: ${res.status} ${text}`);
    }
    const rows = await res.json();
    allRows.push(...rows);
    // Parse Content-Range header to know if there are more pages.
    const range = res.headers.get("content-range") || "";
    // e.g. "0-999/12345" or "0-99/*"
    const m = range.match(/^(\d+)-(\d+)\/(\d+|\*)$/);
    if (!m) {
      // Can't parse, assume done.
      break;
    }
    const end = parseInt(m[2], 10);
    const total = m[3] === "*" ? null : parseInt(m[3], 10);
    if (total !== null && end + 1 >= total) break;
    if (rows.length < pageSize) break; // last page
    offset += pageSize;
  }
  return allRows;
}

// Run a SQL statement against D1 via the Cloudflare REST API.
// We use this instead of `wrangler d1 execute` because it doesn't require
// wrangler to be installed locally. Wrangler is still the recommended way
// for development; this script just gives you a portable fallback.
async function d1Execute(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result?.[0]?.results || [];
}

// Alternative: shell out to `wrangler d1 execute`. Prefer this if wrangler
// is installed because it handles batching and auth via wrangler's config.
function hasWrangler() {
  try {
    execSync("wrangler --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function wranglerD1Execute(sql) {
  // Pipe SQL via stdin to avoid arg-length limits.
  const escaped = sql.replace(/'/g, "'\\''");
  const cmd = `echo '${escaped}' | wrangler d1 execute ${D1_NAME} --remote --command -`;
  console.error("  wrangler> executing batch...");
  execSync(cmd, { stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Migration steps
// ---------------------------------------------------------------------------
async function migrateUsers() {
  // Supabase stores users in auth.users which is NOT exposed via REST.
  // Instead, we derive users from the JWT subjects that have appeared in
  // user_wallets, user_networks, etc. We also fetch auth.users via the
  // Supabase admin API (if available with the service_role key).
  console.log("== Fetching auth.users from Supabase Admin API ==");
  let users = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      users = (data.users || []).map((u) => ({
        id: u.id,
        email: u.email || "",
        email_verified: !!u.email_confirmed_at,
        created_at: u.created_at,
        updated_at: u.updated_at || u.created_at,
      }));
    } else {
      console.warn(`  Admin API not available (${res.status}); skipping users sync.`);
      console.warn(`  Users will be lazily created in D1 on first authenticated request.`);
    }
  } catch (e) {
    console.warn(`  Failed to fetch users: ${e.message}`);
    console.warn(`  Users will be lazily created in D1 on first authenticated request.`);
  }
  if (users.length === 0) return 0;

  for (const u of users) {
    await d1Execute(
      `INSERT INTO users (id, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         email_verified = excluded.email_verified,
         updated_at = excluded.updated_at`,
      [u.id, u.email, u.email_verified ? 1 : 0, u.created_at, u.updated_at]
    );
  }
  console.log(`  Inserted ${users.length} users`);
  return users.length;
}

async function migrateTable(tableName, d1InsertFn, transform = (x) => x) {
  console.log(`== Fetching ${tableName} from Supabase ==`);
  const rows = await fetchAllFromSupabase(tableName);
  console.log(`  Found ${rows.length} rows`);

  if (rows.length === 0) return 0;

  // For each row, build a SQL insert and execute it.
  // We do one-by-one to avoid hitting D1's per-statement size limit and
  // to give better error reporting.
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const transformed = transform(row);
    try {
      await d1InsertFn(transformed);
      inserted++;
    } catch (e) {
      if (e.message.includes("UNIQUE constraint")) {
        skipped++;
      } else {
        console.error(`  Failed to insert row in ${tableName}:`, e.message);
        console.error("  Row was:", JSON.stringify(transformed).slice(0, 200));
      }
    }
  }
  console.log(`  Inserted: ${inserted}, Skipped (existing): ${skipped}`);
  return inserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("================================================================");
  console.log("  Supabase -> D1 Migration");
  console.log("================================================================");
  console.log(`Supabase URL:    ${SUPABASE_URL}`);
  console.log(`D1 Database ID:  ${D1_ID}`);
  console.log(`D1 Database:     ${D1_NAME}`);
  console.log("");

  // DRY RUN: fetch counts only
  console.log("== DRY RUN: counting rows in Supabase ==");
  const tablesToMigrate = [
    "default_networks",
    "user_networks",
    "user_contracts",
    "user_wallets",
    "contracts",
    "transactions",
    "wallet_groups",
    "wallet_group_members",
  ];
  const counts = {};
  for (const t of tablesToMigrate) {
    try {
      const rows = await fetchAllFromSupabase(t);
      counts[t] = rows.length;
      console.log(`  ${t}: ${rows.length}`);
    } catch (e) {
      console.log(`  ${t}: ERROR (${e.message}) — may not exist in Supabase yet`);
      counts[t] = 0;
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Total rows to migrate: ${totalRows}`);
  console.log("");

  if (totalRows === 0) {
    console.log("Nothing to migrate. Exiting.");
    return;
  }

  if (!SKIP_CONFIRM) {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Proceed with migration? (yes/no) ");
    rl.close();
    if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  // Apply schema migration first
  console.log("");
  console.log("== Applying D1 schema (0001_init.sql) ==");
  if (hasWrangler()) {
    try {
      execSync(
        `wrangler d1 execute ${D1_NAME} --remote --file=migrations/0001_init.sql`,
        { stdio: "inherit" }
      );
    } catch (e) {
      console.error("Schema apply failed:", e.message);
      process.exit(1);
    }
  } else {
    console.warn("  wrangler not installed; assuming schema is already applied.");
    console.warn("  Run: wrangler d1 execute " + D1_NAME + " --remote --file=migrations/0001_init.sql");
  }

  // Migrate users first (referenced by all other tables)
  await migrateUsers();

  // Migrate each table
  await migrateTable("default_networks", async (n) => {
    await d1Execute(
      `INSERT INTO default_networks
         (id, name, chain_id, rpc_url, currency_symbol, explorer_url, is_testnet,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         chain_id = excluded.chain_id,
         rpc_url = excluded.rpc_url,
         currency_symbol = excluded.currency_symbol,
         explorer_url = excluded.explorer_url,
         is_testnet = excluded.is_testnet,
         updated_at = excluded.updated_at`,
      [
        n.id,
        n.name,
        n.chain_id,
        n.rpc_url,
        n.currency_symbol,
        n.explorer_url,
        n.is_testnet ? 1 : 0,
        n.created_at || new Date().toISOString(),
        n.updated_at || new Date().toISOString(),
      ]
    );
  });

  await migrateTable("user_networks", async (n) => {
    await d1Execute(
      `INSERT INTO user_networks
         (id, user_id, name, chain_id, rpc_url, currency_symbol, explorer_url,
          is_testnet, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         chain_id = excluded.chain_id,
         rpc_url = excluded.rpc_url,
         currency_symbol = excluded.currency_symbol,
         explorer_url = excluded.explorer_url,
         is_testnet = excluded.is_testnet,
         updated_at = excluded.updated_at`,
      [
        n.id,
        n.user_id,
        n.name,
        n.chain_id,
        n.rpc_url,
        n.currency_symbol,
        n.explorer_url,
        n.is_testnet ? 1 : 0,
        n.created_at || new Date().toISOString(),
        n.updated_at || new Date().toISOString(),
      ]
    );
  });

  await migrateTable("user_contracts", async (c) => {
    await d1Execute(
      `INSERT INTO user_contracts
         (id, user_id, network_id, name, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         address = excluded.address,
         network_id = excluded.network_id,
         updated_at = excluded.updated_at`,
      [
        c.id,
        c.user_id,
        c.network_id,
        c.name,
        (c.address || "").toLowerCase(),
        c.created_at || new Date().toISOString(),
        c.updated_at || new Date().toISOString(),
      ]
    );
  });

  await migrateTable("user_wallets", async (w) => {
    await d1Execute(
      `INSERT INTO user_wallets
         (id, user_id, address, name, is_whitelisted, last_connected,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         is_whitelisted = excluded.is_whitelisted,
         last_connected = excluded.last_connected,
         updated_at = excluded.updated_at`,
      [
        w.id,
        w.user_id,
        (w.address || "").toLowerCase(),
        w.name ?? null,
        w.is_whitelisted ? 1 : 0,
        w.last_connected ?? null,
        w.created_at || new Date().toISOString(),
        w.updated_at || new Date().toISOString(),
      ]
    );
  });

  await migrateTable("contracts", async (c) => {
    await d1Execute(
      `INSERT INTO contracts
         (id, network_id, address, owner, deployed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(network_id, address) DO UPDATE SET
         owner = excluded.owner,
         updated_at = excluded.updated_at`,
      [
        c.id || crypto.randomUUID(),
        c.network_id,
        (c.address || "").toLowerCase(),
        c.owner ?? null,
        c.deployed_at ?? null,
        c.updated_at || new Date().toISOString(),
      ]
    );
  });

  // THE BIG ONE — transactions. This is where the bug lived.
  // We carefully normalize: lowercase wallet_address, ensure user_id is a
  // valid UUID (not a wallet address). If user_id looks like a wallet address
  // (0x... 40 hex), we try to look up the actual user_id from user_wallets.
  await migrateTable("transactions", async (t) => {
    let userId = t.user_id;
    // Bug-fix heuristic: if user_id looks like an ETH address, try to recover
    // the real user_id from user_wallets.
    if (/^0x[a-fA-F0-9]{40}$/.test(userId || "")) {
      const rows = await d1Execute(
        `SELECT user_id FROM user_wallets WHERE address = ? LIMIT 1`,
        [userId.toLowerCase()]
      );
      if (rows.length > 0) {
        console.log(`  Recovered user_id for tx ${t.id} from wallet ${userId}`);
        userId = rows[0].user_id;
      } else {
        console.warn(`  Tx ${t.id} has wallet-as-user_id ${userId} but no matching user_wallets row; skipping.`);
        return;
      }
    }
    await d1Execute(
      `INSERT INTO transactions
         (id, user_id, wallet_address, network_id, contract_id, tx_hash, status,
          amount, recipients, child_contracts, gas_cost, error, timestamp, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         wallet_address = excluded.wallet_address,
         tx_hash = COALESCE(excluded.tx_hash, transactions.tx_hash),
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        t.id,
        userId,
        (t.wallet_address || "").toLowerCase(),
        t.network_id,
        t.contract_id ?? null,
        t.tx_hash ?? null,
        t.status || "pending",
        String(t.amount ?? "0"),
        typeof t.recipients === "string" ? t.recipients : JSON.stringify(t.recipients ?? []),
        typeof t.child_contracts === "string"
          ? t.child_contracts
          : t.child_contracts
            ? JSON.stringify(t.child_contracts)
            : null,
        t.gas_cost ?? null,
        t.error ?? null,
        t.timestamp || new Date().toISOString(),
        t.updated_at || t.timestamp || new Date().toISOString(),
      ]
    );
  });

  await migrateTable("wallet_groups", async (g) => {
    await d1Execute(
      `INSERT INTO wallet_groups (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at`,
      [g.id, g.user_id, g.name, g.created_at, g.updated_at || g.created_at]
    );
  });

  await migrateTable("wallet_group_members", async (m) => {
    await d1Execute(
      `INSERT INTO wallet_group_members (id, group_id, wallet_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(group_id, wallet_id) DO NOTHING`,
      [m.id || crypto.randomUUID(), m.group_id, m.wallet_id, m.created_at]
    );
  });

  console.log("");
  console.log("================================================================");
  console.log("  Migration complete.");
  console.log("================================================================");
  console.log("Your Supabase database was not modified. It remains as a backup.");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Verify D1 has the expected rows: wrangler d1 execute " + D1_NAME + " --remote --command 'SELECT COUNT(*) FROM transactions'");
  console.log("  2. Update your frontend to point at the Worker URL instead of Supabase.");
  console.log("  3. Once you've verified everything works, you can disable Supabase (don't delete it).");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
