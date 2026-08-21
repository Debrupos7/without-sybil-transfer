// ============================================================================
// user-contracts.ts — /user-contracts route (CRUD for per-user saved contracts)
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import {
  newContractSchema,
  updateContractSchema,
  nowIso,
  uuidV4,
} from "../security";

export const userContractsRoute = new Hono<AppContext>();

userContractsRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const networkId = c.req.query("network_id");
  let sql = `SELECT * FROM user_contracts WHERE user_id = ?`;
  const binds: any[] = [user.sub];
  if (networkId) {
    sql += ` AND network_id = ?`;
    binds.push(networkId);
  }
  sql += ` ORDER BY name ASC`;
  const result = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ contracts: result.results || [] });
});

userContractsRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = newContractSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const ct = parsed.data;
  const id = uuidV4();
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO user_contracts
       (id, user_id, network_id, name, address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.sub, ct.network_id, ct.name, ct.address, ts, ts)
    .run();
  const created = await c.env.DB.prepare(
    `SELECT * FROM user_contracts WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ contract: created }, 201);
});

userContractsRoute.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = updateContractSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const ct = parsed.data;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM user_contracts WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "Contract not found" }, 404);
  }

  const sets: string[] = [];
  const binds: any[] = [];
  if (ct.network_id !== undefined) {
    sets.push("network_id = ?");
    binds.push(ct.network_id);
  }
  if (ct.name !== undefined) {
    sets.push("name = ?");
    binds.push(ct.name);
  }
  if (ct.address !== undefined) {
    sets.push("address = ?");
    binds.push(ct.address);
  }
  if (sets.length === 0) {
    return c.json({ error: "bad_request", message: "No fields to update" }, 400);
  }
  sets.push("updated_at = ?");
  binds.push(nowIso());
  binds.push(id, user.sub);

  await c.env.DB.prepare(
    `UPDATE user_contracts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  )
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT * FROM user_contracts WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ contract: updated });
});

userContractsRoute.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `DELETE FROM user_contracts WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "not_found", message: "Contract not found" }, 404);
  }
  return c.json({ deleted: true, id });
});
