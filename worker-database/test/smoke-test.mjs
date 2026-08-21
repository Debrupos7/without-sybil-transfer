// ============================================================================
// smoke-test.mjs — Standalone integration test for the Worker
// ----------------------------------------------------------------------------
// Spins up Miniflare with the bundled Worker + an in-memory D1, then hits
// every endpoint with real HTTP requests. Prints PASS/FAIL for each test
// case and exits non-zero if any test failed.
//
// Usage:
//   node test/smoke-test.mjs
//
// Prerequisites:
//   - .smoke/worker.mjs exists (run: npx esbuild src/index.ts --bundle \
//       --outfile=.smoke/worker.mjs --format=esm --platform=node \
//       --external:cloudflare:*)
//   - migrations/0001_init.sql exists
// ============================================================================

import { Miniflare } from "miniflare";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WORKER_PATH = resolve(ROOT, ".smoke/worker.mjs");
const MIGRATION_PATH = resolve(ROOT, "migrations/0001_init.sql");

const TEST_JWT_SECRET = "test-jwt-secret-with-at-least-32-characters-long-string-for-hs256";
const ALLOWED_ORIGIN = "https://app.example.com";

const USER_A = { sub: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "alice@example.com" };
const USER_B = { sub: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", email: "bob@example.com" };
const ADMIN_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ADMIN = { sub: ADMIN_ID, email: "admin@example.com" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}

function fail(name, why) {
  console.log(`  ✗ ${name}`);
  console.log(`     ${why}`);
  failed++;
  failures.push({ name, why });
}

async function makeJwt(claims) {
  return await new SignJWT({
    sub: claims.sub,
    email: claims.email,
    email_verified: true,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("https://test.supabase.co/auth/v1")
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

// ---------------------------------------------------------------------------
// Miniflare setup
// ---------------------------------------------------------------------------
console.log("Starting Miniflare with the bundled Worker ...");

const mf = new Miniflare({
  // Use the bundled worker file directly. Bundled with --platform=node
  // so Node builtins like node:crypto and node:buffer work via nodejs_compat.
  modules: [{ type: "ESModule", path: WORKER_PATH, contents: readFileSync(WORKER_PATH, "utf8") }],
  modulesRoot: ROOT,
  compatibilityDate: "2024-12-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ADMIN_USER_IDS: ADMIN_ID,
    CLEANUP_API_KEY: "",
    ENVIRONMENT: "test",
  },
  d1Databases: {
    DB: "test-db",
  },
});

// Apply the schema to D1 — strip comments first (D1 exec doesn't accept them).
console.log("Applying D1 schema ...");
const dbInstance = await mf.getD1Database("DB");
const schemaSql = readFileSync(MIGRATION_PATH, "utf8");

// Remove comment lines, PRAGMA, AND inline comments (D1 exec is strict).
const cleanedSql = schemaSql
  .split("\n")
  .filter((line) => !/^\s*--/.test(line))   // strip full-line comments
  .filter((line) => !/^\s*PRAGMA\s+/i.test(line))  // strip PRAGMA
  .map((line) => line.replace(/--.*$/, ""))  // strip inline comments
  .join("\n");

// Split into statements on `;` at end of statement.
const stmts = cleanedSql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let applied = 0;
let failedStmts = 0;
for (const stmt of stmts) {
  if (!stmt) continue;
  try {
    // Use prepare().run() instead of exec() — exec() splits statements
    // internally and may mis-split multi-line CREATE TABLE.
    await dbInstance.prepare(stmt).run();
    applied++;
  } catch (e) {
    failedStmts++;
    console.error(`  ✗ Schema statement failed: ${e.message}`);
    console.error(`    Statement: ${stmt.slice(0, 120)}...`);
  }
}
console.log(`Schema apply summary: ${applied} applied, ${failedStmts} failed.`);

// Sanity check: list tables we expect
const expectedTables = [
  "users", "default_networks", "user_networks", "user_contracts",
  "user_wallets", "contracts", "transactions", "wallet_groups",
  "wallet_group_members", "audit_log", "rate_limit",
];
const tablesResult = await dbInstance
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
const actualTables = (tablesResult.results || []).map((r) => r.name);
const missing = expectedTables.filter((t) => !actualTables.includes(t));
if (missing.length > 0) {
  console.error(`FATAL: missing tables after schema apply: ${missing.join(", ")}`);
  console.error(`Tables present: ${actualTables.join(", ")}`);
  await mf.dispose();
  process.exit(1);
}
console.log(`Verified all ${expectedTables.length} expected tables exist.`);
console.log("");

// ---------------------------------------------------------------------------
// HTTP client helper
// ---------------------------------------------------------------------------
async function fetchJson(method, path, { token, body, origin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const res = await mf.dispatchFetch("https://test.local" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------
console.log("Running tests:");
console.log("");

// 1. Health check ------------------------------------------------------------
{
  const r = await fetchJson("GET", "/healthz");
  if (r.status === 200 && r.json?.ok === true) ok("GET /healthz returns 200");
  else fail("GET /healthz returns 200", `got status=${r.status}, json=${JSON.stringify(r.json)}`);
}

// 2. Auth: missing token ----------------------------------------------------
{
  const r = await fetchJson("GET", "/transactions");
  if (r.status === 401) ok("Missing token -> 401");
  else fail("Missing token -> 401", `got status=${r.status}`);
}

// 3. Auth: garbage token ----------------------------------------------------
{
  const r = await fetchJson("GET", "/transactions", { token: "garbage.token.here" });
  if (r.status === 401) ok("Garbage token -> 401");
  else fail("Garbage token -> 401", `got status=${r.status}`);
}

// 4. Auth: expired token ----------------------------------------------------
{
  const expired = await new SignJWT({ sub: USER_A.sub, email: USER_A.email, email_verified: true, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Date.now() / 1000 - 3600)
    .setIssuer("https://test.supabase.co/auth/v1")
    .setAudience("authenticated")
    .setExpirationTime("0s")
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
  const r = await fetchJson("GET", "/transactions", { token: expired });
  if (r.status === 401) ok("Expired token -> 401");
  else fail("Expired token -> 401", `got status=${r.status}`);
}

// 5. THE BUG FIX: transaction stored with user_id = JWT sub ----------------
{
  const token = await makeJwt(USER_A);
  // Body deliberately puts a wallet address as user_id — Worker MUST ignore it.
  const r = await fetchJson("POST", "/transactions", {
    token,
    body: {
      user_id: "0xWALLET_NOT_USER",
      wallet_address: "0x1234567890123456789012345678901234567890",
      network_id: "sepolia",
      amount: "1.5",
      recipients: JSON.stringify(["0x1234567890123456789012345678901234567890"]),
    },
  });
  if (r.status !== 201) {
    fail("POST /transactions forces user_id from JWT", `status=${r.status}, body=${JSON.stringify(r.json)}`);
  } else if (r.json.transaction.user_id !== USER_A.sub) {
    fail("POST /transactions forces user_id from JWT", `user_id was ${r.json.transaction.user_id}, expected ${USER_A.sub}`);
  } else if (r.json.transaction.user_id === "0xWALLET_NOT_USER") {
    fail("POST /transactions forces user_id from JWT", "user_id was the body's wallet address — bug NOT fixed");
  } else {
    ok("POST /transactions forces user_id from JWT (bug fix verified)");
  }
}

// 6. THE BUG FIX: history returns all of user's txs regardless of wallet ----
{
  const token = await makeJwt(USER_A);
  await fetchJson("POST", "/transactions", {
    token,
    body: { wallet_address: "0x1111111111111111111111111111111111111111", network_id: "sepolia", amount: "1" },
  });
  await fetchJson("POST", "/transactions", {
    token,
    body: { wallet_address: "0x2222222222222222222222222222222222222222", network_id: "sepolia", amount: "2" },
  });
  const r = await fetchJson("GET", "/history", { token });
  if (r.status !== 200) {
    fail("GET /history returns all txs regardless of wallet", `status=${r.status}`);
  } else {
    const wallets = new Set(r.json.transactions.map((t) => t.wallet_address));
    if (r.json.transactions.length >= 3 && wallets.size >= 2) {
      ok(`GET /history returns all txs regardless of wallet (${r.json.transactions.length} txs, ${wallets.size} wallets)`);
    } else {
      fail("GET /history returns all txs regardless of wallet", `only ${r.json.transactions.length} txs across ${wallets.size} wallets`);
    }
  }
}

// 7. Wrong-user access returns 404 (existence not leaked) ------------------
{
  const tokenA = await makeJwt(USER_A);
  const tokenB = await makeJwt(USER_B);
  // Create as A
  const created = await fetchJson("POST", "/transactions", {
    token: tokenA,
    body: { wallet_address: "0xdead000000000000000000000000000000000000", network_id: "sepolia", amount: "1" },
  });
  if (created.status !== 201) {
    fail("Wrong-user access returns 404", `setup create failed: ${created.status}`);
  } else {
    // Try to read as B
    const r = await fetchJson("GET", `/transactions/${created.json.transaction.id}`, { token: tokenB });
    if (r.status === 404) ok("Wrong-user access returns 404 (existence not leaked)");
    else fail("Wrong-user access returns 404", `got status=${r.status} (should be 404)`);
  }
}

// 8. /history/by-email returns the authenticated user's email --------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("GET", "/history/by-email", { token });
  if (r.status === 200 && r.json.email === USER_A.email && r.json.user_id === USER_A.sub) {
    ok(`/history/by-email returns the JWT's email (${USER_A.email})`);
  } else {
    fail("/history/by-email returns the JWT's email", `status=${r.status}, json=${JSON.stringify(r.json)}`);
  }
}

// 9. /history/wallets returns distinct signing wallets ---------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("GET", "/history/wallets", { token });
  if (r.status === 200 && Array.isArray(r.json.wallets)) {
    ok(`/history/wallets returns distinct signing wallets (count: ${r.json.wallets.length})`);
  } else {
    fail("/history/wallets returns distinct signing wallets", `status=${r.status}, json=${JSON.stringify(r.json)}`);
  }
}

// 10. Zod validation: invalid ETH address -----------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("POST", "/wallets", { token, body: { address: "0xnotanaddress" } });
  if (r.status === 400 && r.json?.error === "validation_failed") {
    ok("Invalid ETH address -> 400 validation_failed");
  } else {
    fail("Invalid ETH address -> 400 validation_failed", `status=${r.status}, json=${JSON.stringify(r.json)}`);
  }
}

// 11. Zod validation: missing required field --------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("POST", "/transactions", { token, body: { foo: "bar" } });
  if (r.status === 400 && r.json?.error === "validation_failed") {
    ok("Missing required fields -> 400 validation_failed");
  } else {
    fail("Missing required fields -> 400 validation_failed", `status=${r.status}, json=${JSON.stringify(r.json)}`);
  }
}

// 12. Wallets CRUD ----------------------------------------------------------
{
  const token = await makeJwt(USER_A);
  // Create
  const c = await fetchJson("POST", "/wallets", {
    token,
    body: { address: "0xabcd1234abcd1234abcd1234abcd1234abcd1234", name: "Test wallet" },
  });
  if (c.status !== 201) {
    fail("Wallets CRUD", `create failed: ${c.status}, ${JSON.stringify(c.json)}`);
  } else {
    // List
    const l = await fetchJson("GET", "/wallets", { token });
    if (l.status === 200 && l.json.wallets.length >= 1) ok("Wallets CRUD (create + list)");
    else fail("Wallets CRUD", `list failed: ${l.status}`);
  }
}

// 13. User networks CRUD ----------------------------------------------------
{
  const token = await makeJwt(USER_A);
  const c = await fetchJson("POST", "/user-networks", {
    token,
    body: {
      name: "My Testnet",
      chain_id: 12345,
      rpc_url: "https://example.com",
      currency_symbol: "TST",
      explorer_url: "https://example.com",
      is_testnet: true,
    },
  });
  if (c.status !== 201) {
    fail("User networks CRUD", `create failed: ${c.status}, ${JSON.stringify(c.json)}`);
  } else {
    // Update
    const u = await fetchJson("PUT", `/user-networks/${c.json.network.id}`, {
      token,
      body: { name: "Renamed" },
    });
    // Delete
    const d = await fetchJson("DELETE", `/user-networks/${c.json.network.id}`, { token });
    if (u.status === 200 && d.status === 200) ok("User networks CRUD (create + update + delete)");
    else fail("User networks CRUD", `update=${u.status}, delete=${d.status}`);
  }
}

// 14. Wrong-user cross-access on user_networks ------------------------------
{
  const tokenA = await makeJwt(USER_A);
  const tokenB = await makeJwt(USER_B);
  const c = await fetchJson("POST", "/user-networks", {
    token: tokenA,
    body: {
      name: "A's private net",
      chain_id: 1,
      rpc_url: "https://example.com",
      currency_symbol: "X",
      explorer_url: "https://example.com",
      is_testnet: false,
    },
  });
  if (c.status !== 201) {
    fail("Cross-user isolation on user-networks", `create failed: ${c.status}`);
  } else {
    const u = await fetchJson("PUT", `/user-networks/${c.json.network.id}`, {
      token: tokenB,
      body: { name: "hacked" },
    });
    if (u.status === 404) ok("Cross-user isolation on user-networks (B can't edit A's)");
    else fail("Cross-user isolation on user-networks", `B got status=${u.status} (should be 404)`);
  }
}

// 15. Wallet groups CRUD ----------------------------------------------------
{
  const token = await makeJwt(USER_A);
  // Create two wallets first
  const w1 = await fetchJson("POST", "/wallets", {
    token,
    body: { address: "0xeeee111111111111111111111111111111eeeeee", name: "W1" },
  });
  const w2 = await fetchJson("POST", "/wallets", {
    token,
    body: { address: "0xeeee222222222222222222222222222222eeeeee", name: "W2" },
  });
  if (w1.status !== 201 || w2.status !== 201) {
    fail("Wallet groups CRUD", `wallet setup failed: w1=${w1.status} w2=${w2.status}`);
  } else {
    const c = await fetchJson("POST", "/wallet-groups", {
      token,
      body: { name: "My group", wallet_ids: [w1.json.wallet.id, w2.json.wallet.id] },
    });
    if (c.status !== 201) {
      fail("Wallet groups CRUD", `create failed: ${c.status}, ${JSON.stringify(c.json)}`);
    } else {
      const l = await fetchJson("GET", "/wallet-groups", { token });
      const g = l.json?.groups?.find((x) => x.name === "My group");
      if (g && g.members?.length === 2) ok(`Wallet groups CRUD (create with members, ${g.members.length} members)`);
      else fail("Wallet groups CRUD", `group=${JSON.stringify(g)?.slice(0, 200)}`);
    }
  }
}

// 16. Cleanup endpoint: non-admin gets 403 ----------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("GET", "/cleanup-transactions", { token });
  if (r.status === 403) ok("/cleanup-transactions returns 403 for non-admin");
  else fail("/cleanup-transactions returns 403 for non-admin", `got status=${r.status}`);
}

// 17. Cleanup endpoint: admin can call it ----------------------------------
{
  const token = await makeJwt(ADMIN);
  const r = await fetchJson("GET", "/cleanup-transactions", { token });
  if (r.status === 200) ok("/cleanup-transactions returns 200 for admin");
  else fail("/cleanup-transactions returns 200 for admin", `got status=${r.status}, body=${JSON.stringify(r.json)}`);
}

// 18. CORS: disallowed origin does NOT get the Access-Control-Allow-Origin header
{
  const r = await fetchJson("OPTIONS", "/transactions", { origin: "https://evil.example.com" });
  const acao = r.headers.get("Access-Control-Allow-Origin");
  if (!acao || acao !== "https://evil.example.com") {
    ok(`CORS rejects disallowed origin (no ACAO header echoed back)`);
  } else {
    fail("CORS rejects disallowed origin", `ACAO header was "${acao}" — should not be echoed for disallowed origin`);
  }
}

// 19. CORS: allowed origin gets ACAO header echoed --------------------------
{
  const r = await fetchJson("OPTIONS", "/transactions", { origin: ALLOWED_ORIGIN });
  const acao = r.headers.get("Access-Control-Allow-Origin");
  if (r.status === 204 && acao === ALLOWED_ORIGIN) {
    ok(`CORS allows allowed origin (status=204, ACAO echoed)`);
  } else {
    fail("CORS allows allowed origin", `status=${r.status}, ACAO="${acao}"`);
  }
}

// 20. Security headers present ----------------------------------------------
{
  const r = await fetchJson("GET", "/healthz");
  const checks = [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Strict-Transport-Security", null],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Content-Security-Policy", null],
  ];
  let allOk = true;
  const missing = [];
  for (const [h, v] of checks) {
    const got = r.headers.get(h);
    if (!got) {
      allOk = false;
      missing.push(h);
    } else if (v && got !== v) {
      allOk = false;
      missing.push(`${h}=${got} (expected ${v})`);
    }
  }
  if (allOk) ok("All security headers present");
  else fail("All security headers present", `missing/wrong: ${missing.join(", ")}`);
}

// 21. Audit log is being populated ------------------------------------------
{
  const count = await dbInstance.prepare("SELECT COUNT(*) AS n FROM audit_log").first();
  if (count.n > 0) ok(`Audit log is populated (${count.n} entries)`);
  else fail("Audit log is populated", "no entries found");
}

// 22. User is auto-created on first authenticated request ------------------
{
  const token = await makeJwt(USER_A);
  // User A should exist (we've made many requests already)
  const u = await dbInstance.prepare("SELECT * FROM users WHERE id = ?").bind(USER_A.sub).first();
  if (u && u.email === USER_A.email) ok(`User auto-created on auth (${u.email})`);
  else fail("User auto-created on auth", `user row: ${JSON.stringify(u)}`);
}

// 23. /networks returns mainnet/testnet object ------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("GET", "/networks", { token });
  if (r.status === 200 && r.json?.mainnet && r.json?.testnet) {
    ok(`/networks returns { mainnet, testnet } object`);
  } else {
    fail("/networks returns { mainnet, testnet } object", `status=${r.status}, json=${JSON.stringify(r.json)?.slice(0, 200)}`);
  }
}

// 24. SCHEMA-LEVEL BUG FIX: trying to insert a transaction with user_id = wallet address
//     fails due to the foreign key constraint on transactions.user_id REFERENCES users(id).
//     This is a DEFENSE-IN-DEPTH: even if a future bug lets the body's user_id through,
//     the schema itself rejects any user_id that isn't a real user row.
{
  let schemaRejected = false;
  try {
    await dbInstance.prepare(
      `INSERT INTO transactions (id, user_id, wallet_address, network_id, status, amount, timestamp)
       VALUES (?, ?, ?, 'sepolia', 'success', '99', ?)`
    ).bind(
      "bug-tx-1",
      "0xBuggedUserId1234567890123456789012345678901",  // wallet-as-user_id (the bug)
      "0xBuggedWallet123456789012345678901234567890123",
      new Date().toISOString()
    ).run();
  } catch (e) {
    schemaRejected = e.message.includes("FOREIGN KEY constraint") ||
                     e.message.includes("SQLITE_CONSTRAINT");
  }
  if (schemaRejected) {
    ok("Schema rejects transactions with wallet-as-user_id (defense-in-depth)");
  } else {
    fail("Schema rejects transactions with wallet-as-user_id", "FK constraint did not trigger — bug could recur at the schema level");
  }
}

// 25. Update transaction status (PUT) ------------------------------------
{
  const token = await makeJwt(USER_A);
  // Create
  const c = await fetchJson("POST", "/transactions", {
    token,
    body: { wallet_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", network_id: "sepolia", amount: "5" },
  });
  if (c.status !== 201) {
    fail("Update transaction status (PUT)", `create failed: ${c.status}`);
  } else {
    // Update status to 'success'
    const u = await fetchJson("PUT", `/transactions/${c.json.transaction.id}`, {
      token,
      body: { status: "success", tx_hash: "0x" + "ab".repeat(32) },
    });
    if (u.status === 200 && u.json.transaction.status === "success") {
      ok("Update transaction status (PUT)");
    } else {
      fail("Update transaction status (PUT)", `status=${u.status}, body=${JSON.stringify(u.json)?.slice(0, 200)}`);
    }
  }
}

// 26. DELETE transaction ---------------------------------------------------
{
  const token = await makeJwt(USER_A);
  const c = await fetchJson("POST", "/transactions", {
    token,
    body: { wallet_address: "0xcafe1234cafe1234cafe1234cafe1234cafe1234", network_id: "sepolia", amount: "1" },
  });
  const d = await fetchJson("DELETE", `/transactions/${c.json.transaction.id}`, { token });
  if (d.status === 200 && d.json.deleted === true) {
    ok("DELETE /transactions/:id");
  } else {
    fail("DELETE /transactions/:id", `status=${d.status}, body=${JSON.stringify(d.json)}`);
  }
}

// 27. Invalid status in POST body -----------------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("POST", "/transactions", {
    token,
    body: {
      wallet_address: "0xabcd1234abcd1234abcd1234abcd1234abcd1234",
      network_id: "sepolia",
      amount: "1",
      status: "bogus_status",  // invalid enum
    },
  });
  if (r.status === 400 && r.json?.error === "validation_failed") {
    ok("Invalid status enum -> 400 validation_failed");
  } else {
    fail("Invalid status enum -> 400 validation_failed", `status=${r.status}, body=${JSON.stringify(r.json)?.slice(0, 200)}`);
  }
}

// 28. Invalid amount (non-decimal) -----------------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("POST", "/transactions", {
    token,
    body: {
      wallet_address: "0xabcd1234abcd1234abcd1234abcd1234abcd1234",
      network_id: "sepolia",
      amount: "not-a-number",
    },
  });
  if (r.status === 400 && r.json?.error === "validation_failed") {
    ok("Invalid amount -> 400 validation_failed");
  } else {
    fail("Invalid amount -> 400 validation_failed", `status=${r.status}, body=${JSON.stringify(r.json)?.slice(0, 200)}`);
  }
}

// 29. 404 on unknown route -------------------------------------------------
{
  const token = await makeJwt(USER_A);
  const r = await fetchJson("GET", "/nonexistent-endpoint", { token });
  if (r.status === 404) ok("Unknown route -> 404");
  else fail("Unknown route -> 404", `got status=${r.status}`);
}

// 30. Audit log captures method, path, status ------------------------------
{
  const token = await makeJwt(USER_A);
  // Make a known request
  await fetchJson("GET", "/history", { token });
  // Check audit log has the entry
  const row = await dbInstance.prepare(
    `SELECT method, path, status FROM audit_log
     WHERE user_id = ? AND method = 'GET' AND path = '/history'
     ORDER BY id DESC LIMIT 1`
  ).bind(USER_A.sub).first();
  if (row && row.method === "GET" && row.path === "/history" && row.status === 200) {
    ok("Audit log captures method, path, status");
  } else {
    fail("Audit log captures method, path, status", `row=${JSON.stringify(row)}`);
  }
}

// 31. Rate limit: per-IP limit (configured very high for tests, so we just verify
//     the rate_limit table is being populated)
{
  const token = await makeJwt(USER_A);
  await fetchJson("GET", "/history", { token });
  const ipBucket = await dbInstance.prepare(
    `SELECT count FROM rate_limit WHERE key LIKE 'ip:%' LIMIT 1`
  ).first();
  if (ipBucket && ipBucket.count > 0) {
    ok(`Rate limit bucket populated for IP (count: ${ipBucket.count})`);
  } else {
    fail("Rate limit bucket populated for IP", `bucket=${JSON.stringify(ipBucket)}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("");
console.log("================================================================");
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
if (failures.length > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of failures) {
    console.log(`  - ${f.name}`);
    console.log(`    ${f.why}`);
  }
}
console.log("================================================================");

await mf.dispose();
process.exit(failed > 0 ? 1 : 0);
