// ============================================================================
// routes/auth.ts — Public auth endpoints (sign-up, sign-in)
// ----------------------------------------------------------------------------
// These routes are PUBLIC (no JWT required). They handle user registration
// and authentication, returning a signed JWT for the client to use.
// ============================================================================

import { Hono } from "hono";
import { z } from "zod";
import { signJwt, hashPassword, verifyPassword, AuthError } from "../auth";
import { nowIso } from "../security";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT: string;
};

const authRoute = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const signUpSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signInSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// POST /auth/sign-up — Register a new user
// ---------------------------------------------------------------------------
authRoute.post("/sign-up", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body", message: "Invalid JSON body" }, 400);
  }

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_error",
        message: parsed.error.issues.map((i) => i.message).join(", "),
      },
      400
    );
  }

  const { email, password } = parsed.data;
  const emailLower = email.toLowerCase().trim();

  // Check if user already exists
  const existing = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(emailLower)
    .first<{ id: string; password_hash: string | null }>();

  if (existing) {
    // Migrated users from Supabase have no password_hash — let them claim their account
    if (!existing.password_hash) {
      const passwordHash = await hashPassword(password);
      const now = nowIso();
      await c.env.DB.prepare(
        `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`
      )
        .bind(passwordHash, now, existing.id)
        .run();

      const token = await signJwt(
        { sub: existing.id, email: emailLower, emailVerified: true },
        c.env.JWT_SECRET
      );
      return c.json({
        token,
        user: { id: existing.id, email: emailLower },
      }, 200);
    }

    return c.json(
      { error: "conflict", message: "An account with this email already exists" },
      409
    );
  }

  // Create user
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  )
    .bind(userId, emailLower, passwordHash, now, now)
    .run();

  // Sign JWT
  const token = await signJwt(
    { sub: userId, email: emailLower, emailVerified: true },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    user: { id: userId, email: emailLower },
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /auth/sign-in — Authenticate an existing user
// ---------------------------------------------------------------------------
authRoute.post("/sign-in", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body", message: "Invalid JSON body" }, 400);
  }

  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation_error",
        message: parsed.error.issues.map((i) => i.message).join(", "),
      },
      400
    );
  }

  const { email, password } = parsed.data;
  const emailLower = email.toLowerCase().trim();

  // Look up user
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash FROM users WHERE email = ?"
  )
    .bind(emailLower)
    .first<{ id: string; email: string; password_hash: string }>();

  if (!user) {
    return c.json(
      { error: "invalid_credentials", message: "Invalid email or password" },
      401
    );
  }

  // Migrated users from Supabase have no password_hash yet
  if (!user.password_hash) {
    return c.json(
      { error: "needs_password", message: "This account needs a password. Please sign up with your email and a new password to activate your account." },
      400
    );
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json(
      { error: "invalid_credentials", message: "Invalid email or password" },
      401
    );
  }

  // Update last seen
  await c.env.DB.prepare("UPDATE users SET updated_at = ? WHERE id = ?")
    .bind(nowIso(), user.id)
    .run();

  // Sign JWT
  const token = await signJwt(
    { sub: user.id, email: user.email, emailVerified: true },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    user: { id: user.id, email: user.email },
  });
});

authRoute.get("/me", (c) => {
  const user = c.get("user" as any) as { sub: string; email: string } | undefined;
  if (!user) {
    return c.json({ error: "unauthorized", message: "Not authenticated" }, 401);
  }
  return c.json({ user: { id: user.sub, email: user.email } });
});

export { authRoute };
