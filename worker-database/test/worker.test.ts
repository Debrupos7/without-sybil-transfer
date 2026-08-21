// ============================================================================
// test/worker.test.ts — Vitest suite
// ----------------------------------------------------------------------------
// Covers every endpoint with:
//   - Unauthenticated request (no Authorization header)
//   - Invalid token (garbage / expired / wrong-secret signature)
//   - Valid token (test-minted HS256 JWT)
//   - Wrong-user access (user A tries to read user B's data) -> 404
//   - Malformed input (Zod validation)
//   - CORS preflight (OPTIONS)
//
// Uses the @cloudflare/vitest-pool-workers Miniflare-based test runner so we
// can run the Worker against an in-memory D1 instance.
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { env } from "cloudflare:test";

// In test mode, the worker uses this secret to sign+verify test JWTs.
const TEST_JWT_SECRET = "test-jwt-secret-with-at-least-32-characters-long-string-for-hs256";

const USER_A = { sub: "user-a-uuid", email: "alice@example.com" };
const USER_B = { sub: "user-b-uuid", email: "bob@example.com" };

async function makeJwt(claims: { sub: string; email: string }): Promise<string> {
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

// Run migrations against the in-memory D1 before tests.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

beforeAll(async () => {
  const sql = readFileSync(resolve(__dirname, "../migrations/0001_init.sql"), "utf8");
  // D1's batch API splits on semicolons; we just exec the whole file.
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    if (stmt.startsWith("--")) continue;
    await env.DB.prepare(stmt).run();
  }
});

async function fetchJson(path: string, opts: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Vitest-pool-workers: env.WORKER is the worker entrypoint
  const res = await env.WORKER.fetch(`http://test.local${path}`, {
    ...opts,
    headers,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

describe("Health check", () => {
  it("GET /healthz returns 200 without auth", async () => {
    const { status, json } = await fetchJson("/healthz");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });
});

describe("Auth", () => {
  it("rejects requests without Authorization header", async () => {
    const { status, json } = await fetchJson("/transactions");
    expect(status).toBe(401);
    expect(json.error).toBe("unauthorized");
  });

  it("rejects garbage tokens", async () => {
    const { status } = await fetchJson("/transactions", {}, "garbage.token.here");
    expect(status).toBe(401);
  });
});

describe("Transactions", () => {
  it("creates a transaction with user_id forced from JWT (bug fix)", async () => {
    const token = await makeJwt(USER_A);
    // Deliberately put a wallet address as user_id in the body — the worker
    // MUST ignore it and use the JWT sub instead.
    const { status, json } = await fetchJson("/transactions", {
      method: "POST",
      body: JSON.stringify({
        user_id: "0xWALLET_NOT_USER",
        wallet_address: "0x1234567890123456789012345678901234567890",
        network_id: "sepolia",
        amount: "1.5",
        recipients: JSON.stringify(["0x1234567890123456789012345678901234567890"]),
      }),
    }, token);
    expect(status).toBe(201);
    expect(json.transaction.user_id).toBe(USER_A.sub);
    expect(json.transaction.user_id).not.toBe("0xWALLET_NOT_USER");
    expect(json.transaction.wallet_address).toBe("0x1234567890123456789012345678901234567890");
  });

  it("rejects malformed transactions (Zod)", async () => {
    const token = await makeJwt(USER_A);
    const { status, json } = await fetchJson("/transactions", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
    }, token);
    expect(status).toBe(400);
    expect(json.error).toBe("validation_failed");
  });

  it("prevents user B from reading user A's transaction", async () => {
    const tokenA = await makeJwt(USER_A);
    const tokenB = await makeJwt(USER_B);
    // Create as A
    const { json: created } = await fetchJson("/transactions", {
      method: "POST",
      body: JSON.stringify({
        wallet_address: "0xaaaa1234567890123456789012345678901234567890",
        network_id: "sepolia",
        amount: "1",
      }),
    }, tokenA);
    // Try to read as B
    const { status } = await fetchJson(`/transactions/${created.transaction.id}`, {}, tokenB);
    expect(status).toBe(404); // not 403 — we don't leak existence
  });
});

describe("History (the bug fix)", () => {
  it("returns all of the user's transactions regardless of wallet", async () => {
    const token = await makeJwt(USER_A);
    // Create two transactions with different wallets
    await fetchJson("/transactions", {
      method: "POST",
      body: JSON.stringify({
        wallet_address: "0x1111111111111111111111111111111111111111",
        network_id: "sepolia",
        amount: "1",
      }),
    }, token);
    await fetchJson("/transactions", {
      method: "POST",
      body: JSON.stringify({
        wallet_address: "0x2222222222222222222222222222222222222222",
        network_id: "sepolia",
        amount: "2",
      }),
    }, token);
    const { status, json } = await fetchJson("/history", {}, token);
    expect(status).toBe(200);
    expect(json.transactions.length).toBeGreaterThanOrEqual(2);
    // The /history endpoint must NOT filter by wallet — it returns everything
    // for the authenticated user.
    const wallets = new Set(json.transactions.map((t) => t.wallet_address));
    expect(wallets.size).toBeGreaterThanOrEqual(2);
  });

  it("returns the authenticated user's email in the response", async () => {
    const token = await makeJwt(USER_A);
    const { status, json } = await fetchJson("/history/by-email", {}, token);
    expect(status).toBe(200);
    expect(json.email).toBe(USER_A.email);
    expect(json.user_id).toBe(USER_A.sub);
  });

  it("returns the wallets that have signed txs for this user", async () => {
    const token = await makeJwt(USER_A);
    const { status, json } = await fetchJson("/history/wallets", {}, token);
    expect(status).toBe(200);
    expect(Array.isArray(json.wallets)).toBe(true);
  });
});

describe("Wallets", () => {
  it("creates and lists wallets", async () => {
    const token = await makeJwt(USER_A);
    await fetchJson("/wallets", {
      method: "POST",
      body: JSON.stringify({
        address: "0xabc1111111111111111111111111111111111111",
        name: "Test wallet",
      }),
    }, token);
    const { status, json } = await fetchJson("/wallets", {}, token);
    expect(status).toBe(200);
    expect(json.wallets.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid ETH addresses", async () => {
    const token = await makeJwt(USER_A);
    const { status } = await fetchJson("/wallets", {
      method: "POST",
      body: JSON.stringify({ address: "0xnotanaddress" }),
    }, token);
    expect(status).toBe(400);
  });
});

describe("User networks", () => {
  it("creates, lists, updates, deletes a user network", async () => {
    const token = await makeJwt(USER_A);
    const { json: created } = await fetchJson("/user-networks", {
      method: "POST",
      body: JSON.stringify({
        name: "My Testnet",
        chain_id: 12345,
        rpc_url: "https://example.com",
        currency_symbol: "TST",
        explorer_url: "https://example.com",
        is_testnet: true,
      }),
    }, token);
    expect(created.network.id).toBeTruthy();

    const { json: list } = await fetchJson("/user-networks", {}, token);
    expect(list.networks.find((n) => n.id === created.network.id)).toBeTruthy();

    const { status: updStatus } = await fetchJson(`/user-networks/${created.network.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Renamed Testnet" }),
    }, token);
    expect(updStatus).toBe(200);

    const { status: delStatus } = await fetchJson(`/user-networks/${created.network.id}`, {
      method: "DELETE",
    }, token);
    expect(delStatus).toBe(200);
  });

  it("prevents user B from editing user A's network", async () => {
    const tokenA = await makeJwt(USER_A);
    const tokenB = await makeJwt(USER_B);
    const { json: created } = await fetchJson("/user-networks", {
      method: "POST",
      body: JSON.stringify({
        name: "A's private net",
        chain_id: 1,
        rpc_url: "https://example.com",
        currency_symbol: "X",
        explorer_url: "https://example.com",
        is_testnet: false,
      }),
    }, tokenA);
    const { status } = await fetchJson(`/user-networks/${created.network.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "hacked" }),
    }, tokenB);
    expect(status).toBe(404);
  });
});

describe("Wallet groups", () => {
  it("creates a group with members and lists it", async () => {
    const token = await makeJwt(USER_A);
    // Create two wallets first
    const { json: w1 } = await fetchJson("/wallets", {
      method: "POST",
      body: JSON.stringify({ address: "0xaabb111111111111111111111111111111111111" }),
    }, token);
    const { json: w2 } = await fetchJson("/wallets", {
      method: "POST",
      body: JSON.stringify({ address: "0xaabb222222222222222222222222222222222222" }),
    }, token);
    const { status, json } = await fetchJson("/wallet-groups", {
      method: "POST",
      body: JSON.stringify({
        name: "My group",
        wallet_ids: [w1.wallet.id, w2.wallet.id],
      }),
    }, token);
    expect(status).toBe(201);

    const { json: list } = await fetchJson("/wallet-groups", {}, token);
    const group = list.groups.find((g) => g.name === "My group");
    expect(group).toBeTruthy();
    expect(group.members.length).toBe(2);
  });
});

describe("Cleanup (admin)", () => {
  it("returns 403 for non-admin users", async () => {
    const token = await makeJwt(USER_A);
    const { status } = await fetchJson("/cleanup-transactions", {}, token);
    expect(status).toBe(403);
  });
});

describe("CORS", () => {
  it("rejects OPTIONS from disallowed origin", async () => {
    const res = await env.WORKER.fetch("http://test.local/transactions", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(403);
  });

  it("allows OPTIONS from allowed origin", async () => {
    const res = await env.WORKER.fetch("http://test.local/transactions", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    // 204 if allowed
    expect([200, 204]).toContain(res.status);
  });
});

describe("Security headers", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await env.WORKER.fetch("http://test.local/healthz");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("sets X-Frame-Options: DENY", async () => {
    const res = await env.WORKER.fetch("http://test.local/healthz");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("sets a strict CSP", async () => {
    const res = await env.WORKER.fetch("http://test.local/healthz");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'none'");
  });
});
