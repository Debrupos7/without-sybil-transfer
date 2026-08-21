// ============================================================================
// auth.ts — JWT verification for Supabase tokens (RS256 / HS256 hybrid)
// ----------------------------------------------------------------------------
// We verify the JWT signed by Supabase Auth so that the Worker can trust the
// `sub` claim as the user_id. This gives us a drop-in equivalent of Supabase
// RLS: every query is scoped by the verified user_id.
//
// Why both RS256 and HS256? Supabase signs access tokens with the project's
// JWT secret (HS256) by default. Some configurations use RS256 with a JWKS
// URL. We try HS256 first (cheap, no network call), then fall back to JWKS.
// ============================================================================

import { jwtVerify, createRemoteJWKSet } from "jose";

export type AuthenticatedUser = {
  sub: string;            // supabase user id
  email: string;
  emailVerified: boolean;
  role: "anon" | "authenticated" | "service_role";
  exp: number;
  raw: string;             // the original token (for audit logging)
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Verify a Supabase-issued JWT.
 *
 * @param token - the raw Bearer token from Authorization header
 * @param config - { jwtSecret: string (HS256 secret), jwksUri?: string (RS256 fallback) }
 * @returns AuthenticatedUser or throws
 */
export async function verifySupabaseJwt(
  token: string,
  config: { jwtSecret: string; jwksUri?: string; issuer?: string }
): Promise<AuthenticatedUser> {
  if (!token) throw new AuthError("missing_token", "No bearer token provided");

  // Try HS256 first (Supabase default, no network call)
  try {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: config.issuer,
      audience: "authenticated",
    });
    return payloadToUser(payload, token);
  } catch (hsErr) {
    // If the secret is configured, HS256 is the expected path. If it failed
    // because of alg mismatch, fall through to RS256/JWKS.
    if (!config.jwksUri) {
      throw new AuthError("invalid_token", `HS256 verification failed: ${(hsErr as Error).message}`);
    }
  }

  // RS256 fallback via JWKS
  if (!jwks && config.jwksUri) {
    jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }
  try {
    const { payload } = await jwtVerify(token, jwks!, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: "authenticated",
    });
    return payloadToUser(payload, token);
  } catch (rsErr) {
    throw new AuthError("invalid_token", `RS256 verification failed: ${(rsErr as Error).message}`);
  }
}

function payloadToUser(payload: any, raw: string): AuthenticatedUser {
  if (!payload.sub) throw new AuthError("invalid_token", "JWT missing sub claim");
  if (!payload.email) throw new AuthError("invalid_token", "JWT missing email claim");
  const role = (payload.role as AuthenticatedUser["role"]) ?? "authenticated";
  if (role !== "authenticated" && role !== "service_role") {
    throw new AuthError("invalid_token", `Unexpected role: ${role}`);
  }
  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase().trim(),
    emailVerified: !!payload.email_verified,
    role,
    exp: Number(payload.exp ?? 0),
    raw,
  };
}

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

/**
 * Extract bearer token from request, tolerant of "Bearer xxx" or "xxx".
 */
export function extractBearer(req: Request): string {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : h.trim();
}
