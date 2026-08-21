// ============================================================================
// transactions.ts — /transactions route
// ----------------------------------------------------------------------------
// Endpoints:
//   GET    /transactions                — list current user's transactions
//   GET    /transactions?wallet=0x...   — filter by wallet (still scoped to user)
//   GET    /transactions?network_id=xxx — filter by network
//   GET    /transactions/:id            — fetch one (must belong to user)
//   POST   /transactions                — insert (user_id forced to JWT sub)
//   PUT    /transactions/:id            — update (only owner)
//   DELETE /transactions/:id            — delete (only owner)
//
// SECURITY: every query is scoped by user_id from the verified JWT.
// The wallet_address is stored separately so /history can be queried by
// EITHER user_id (preferred) OR wallet_address (for "which transactions did
// this wallet sign"). The /history endpoint always returns rows scoped to
// the authenticated user's user_id, regardless of which wallet they connect.
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import {
  newTransactionSchema,
  updateTransactionSchema,
  nowIso,
  uuidV4,
} from "../security";

export const transactionsRoute = new Hono<AppContext>();

// GET /transactions
transactionsRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const wallet = c.req.query("wallet")?.toLowerCase();
  const networkId = c.req.query("network_id");
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

  const where: string[] = ["user_id = ?"];
  const binds: any[] = [user.sub];

  if (wallet) {
    where.push("wallet_address = ?");
    binds.push(wallet);
  }
  if (networkId) {
    where.push("network_id = ?");
    binds.push(networkId);
  }
  if (status && ["pending", "success", "failed"].includes(status)) {
    where.push("status = ?");
    binds.push(status);
  }

  const sql = `SELECT * FROM transactions WHERE ${where.join(" AND ")}
               ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ transactions: result.results || [], count: result.results?.length || 0 });
});

// GET /transactions/:id
transactionsRoute.get("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT * FROM transactions WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!row) {
    return c.json({ error: "not_found", message: "Transaction not found" }, 404);
  }
  return c.json({ transaction: row });
});

// POST /transactions
transactionsRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = newTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", issues: parsed.error.issues },
      400
    );
  }
  const tx = parsed.data;

  // Force user_id from the JWT, NOT from the body. This is the bug fix —
  // the original Supabase code had `user_id: user?.id || account || ''`,
  // which meant if user.id was undefined, the wallet address got stored as
  // user_id, and switching wallets made the history disappear.
  const id = uuidV4();
  const ts = tx.timestamp || nowIso();
  await c.env.DB.prepare(
    `INSERT INTO transactions
       (id, user_id, wallet_address, network_id, contract_id, tx_hash, status,
        amount, recipients, child_contracts, gas_cost, error, timestamp, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.sub,                  // FORCED from JWT, never from body
      tx.wallet_address,
      tx.network_id,
      tx.contract_id ?? null,
      tx.tx_hash ?? null,
      tx.status,
      tx.amount,
      tx.recipients ?? null,
      tx.child_contracts ?? null,
      tx.gas_cost ?? null,
      tx.error ?? null,
      ts,
      nowIso()
    )
    .run();

  const created = await c.env.DB.prepare(
    `SELECT * FROM transactions WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ transaction: created }, 201);
});

// PUT /transactions/:id
transactionsRoute.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = updateTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", issues: parsed.error.issues },
      400
    );
  }
  const tx = parsed.data;

  // Check ownership first
  const existing = await c.env.DB.prepare(
    `SELECT id FROM transactions WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "Transaction not found" }, 404);
  }

  // Build update SET clause dynamically
  const sets: string[] = [];
  const binds: any[] = [];
  for (const [k, v] of Object.entries(tx)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    binds.push(v);
  }
  if (sets.length === 0) {
    return c.json({ error: "bad_request", message: "No fields to update" }, 400);
  }
  sets.push("updated_at = ?");
  binds.push(nowIso());
  binds.push(id, user.sub);

  await c.env.DB.prepare(
    `UPDATE transactions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  )
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT * FROM transactions WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ transaction: updated });
});

// DELETE /transactions/:id
transactionsRoute.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `DELETE FROM transactions WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "not_found", message: "Transaction not found" }, 404);
  }
  return c.json({ deleted: true, id });
});
