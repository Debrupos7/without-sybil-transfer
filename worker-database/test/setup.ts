// test/setup.ts — runs the D1 migration on the in-memory database before tests.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "cloudflare:test";

export async function setup() {
  const sqlPath = resolve(__dirname, "../migrations/0001_init.sql");
  const sql = readFileSync(sqlPath, "utf8");
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    if (stmt.startsWith("--")) continue;
    await env.DB.prepare(stmt).run();
  }
}
