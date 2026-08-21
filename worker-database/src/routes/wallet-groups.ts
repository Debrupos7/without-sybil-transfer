// ============================================================================
// wallet-groups.ts — /wallet-groups route (full CRUD + member management)
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import {
  newWalletGroupSchema,
  updateWalletGroupSchema,
  nowIso,
  uuidV4,
  uuidSchema,
} from "../security";

export const walletGroupsRoute = new Hono<AppContext>();

// GET /wallet-groups — list user's groups (with members)
walletGroupsRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const groups = await c.env.DB.prepare(
    `SELECT * FROM wallet_groups WHERE user_id = ? ORDER BY name ASC`
  )
    .bind(user.sub)
    .all();

  const groupIds = (groups.results || []).map((g) => (g as any).id);
  let membersByGroup: Record<string, any[]> = {};
  if (groupIds.length > 0) {
    // Bind an IN(...) clause safely.
    const placeholders = groupIds.map(() => "?").join(",");
    const memberRows = await c.env.DB.prepare(
      `SELECT m.group_id, m.id AS member_id, w.id AS wallet_id, w.address, w.name
         FROM wallet_group_members m
         JOIN user_wallets w ON w.id = m.wallet_id
         WHERE m.group_id IN (${placeholders})`
    )
      .bind(...groupIds)
      .all();
    for (const m of memberRows.results || []) {
      const gid = (m as any).group_id;
      (membersByGroup[gid] ||= []).push(m);
    }
  }

  const result = (groups.results || []).map((g) => ({
    ...g,
    members: membersByGroup[(g as any).id] || [],
  }));
  return c.json({ groups: result });
});

// POST /wallet-groups
walletGroupsRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = newWalletGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const g = parsed.data;
  const id = uuidV4();
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO wallet_groups (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, user.sub, g.name, ts, ts)
    .run();

  // Insert members
  if (g.wallet_ids && g.wallet_ids.length > 0) {
    // Verify each wallet belongs to the user before adding.
    for (const wid of g.wallet_ids) {
      const owned = await c.env.DB.prepare(
        `SELECT id FROM user_wallets WHERE id = ? AND user_id = ?`
      )
        .bind(wid, user.sub)
        .first();
      if (!owned) continue; // skip silently — alternatively, error out
      const mid = uuidV4();
      await c.env.DB.prepare(
        `INSERT INTO wallet_group_members (id, group_id, wallet_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(group_id, wallet_id) DO NOTHING`
      )
        .bind(mid, id, wid, ts)
        .run();
    }
  }

  const created = await c.env.DB.prepare(
    `SELECT * FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ group: created }, 201);
});

// PUT /wallet-groups/:id — update name and/or replace members
walletGroupsRoute.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = updateWalletGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const g = parsed.data;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "Group not found" }, 404);
  }

  if (g.name !== undefined) {
    await c.env.DB.prepare(
      `UPDATE wallet_groups SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    )
      .bind(g.name, nowIso(), id, user.sub)
      .run();
  }

  // Replace members if wallet_ids was provided
  if (g.wallet_ids !== undefined) {
    await c.env.DB.prepare(
      `DELETE FROM wallet_group_members WHERE group_id = ?`
    )
      .bind(id)
      .run();
    for (const wid of g.wallet_ids) {
      const owned = await c.env.DB.prepare(
        `SELECT id FROM user_wallets WHERE id = ? AND user_id = ?`
      )
        .bind(wid, user.sub)
        .first();
      if (!owned) continue;
      const mid = uuidV4();
      await c.env.DB.prepare(
        `INSERT INTO wallet_group_members (id, group_id, wallet_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(group_id, wallet_id) DO NOTHING`
      )
        .bind(mid, id, wid, nowIso())
        .run();
    }
  }

  const updated = await c.env.DB.prepare(
    `SELECT * FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ group: updated });
});

// DELETE /wallet-groups/:id
walletGroupsRoute.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `DELETE FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "not_found", message: "Group not found" }, 404);
  }
  return c.json({ deleted: true, id });
});

// POST /wallet-groups/:id/members — add a wallet to a group
walletGroupsRoute.post("/:id/members", async (c) => {
  const user = c.get("user")!;
  const groupId = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const walletId = (body as any)?.wallet_id;
  const parsedWallet = uuidSchema.safeParse(walletId);
  if (!parsedWallet.success) {
    return c.json({ error: "validation_failed", issues: parsedWallet.error.issues }, 400);
  }
  // Verify ownership
  const group = await c.env.DB.prepare(
    `SELECT id FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(groupId, user.sub)
    .first();
  if (!group) {
    return c.json({ error: "not_found", message: "Group not found" }, 404);
  }
  const wallet = await c.env.DB.prepare(
    `SELECT id FROM user_wallets WHERE id = ? AND user_id = ?`
  )
    .bind(parsedWallet.data, user.sub)
    .first();
  if (!wallet) {
    return c.json({ error: "not_found", message: "Wallet not found" }, 404);
  }
  const mid = uuidV4();
  await c.env.DB.prepare(
    `INSERT INTO wallet_group_members (id, group_id, wallet_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, wallet_id) DO NOTHING`
  )
    .bind(mid, groupId, parsedWallet.data, nowIso())
    .run();
  return c.json({ member_id: mid }, 201);
});

// DELETE /wallet-groups/:id/members/:wallet_id — remove a wallet from a group
walletGroupsRoute.delete("/:id/members/:wallet_id", async (c) => {
  const user = c.get("user")!;
  const groupId = c.req.param("id");
  const walletId = c.req.param("wallet_id");
  // Verify ownership of the group
  const group = await c.env.DB.prepare(
    `SELECT id FROM wallet_groups WHERE id = ? AND user_id = ?`
  )
    .bind(groupId, user.sub)
    .first();
  if (!group) {
    return c.json({ error: "not_found", message: "Group not found" }, 404);
  }
  await c.env.DB.prepare(
    `DELETE FROM wallet_group_members WHERE group_id = ? AND wallet_id = ?`
  )
    .bind(groupId, walletId)
    .run();
  return c.json({ deleted: true, wallet_id: walletId });
});
