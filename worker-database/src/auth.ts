// ============================================================================
// auth.ts — JWT sign + verify using our own secret (no more Supabase)
// ----------------------------------------------------------------------------
// Signs and verifies HS256 JWTs using jose. The Worker is now the sole
// authority for authentication — no external auth provider needed.
// ============================================================================

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  emailVerified: boolean;
  exp: number;
  raw: string;
};

/**
 * Sign a new JWT for an authenticated user.
 */
export async function signJwt(
  payload: { sub: string; email: string; emailVerified?: boolean },
  secret: string,
  expiresIn: string = "7d"
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.emailVerified ?? false,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("sybil-transfer-worker")
    .setAudience("authenticated")
    .setExpirationTime(expiresIn)
    .sign(key);
}

/**
 * Verify a JWT signed by this Worker.
 */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<AuthenticatedUser> {
  if (!token) throw new AuthError("missing_token", "No bearer token provided");

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: "sybil-transfer-worker",
    audience: "authenticated",
  });

  if (!payload.sub) throw new AuthError("invalid_token", "JWT missing sub claim");
  if (!payload.email) throw new AuthError("invalid_token", "JWT missing email claim");

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase().trim(),
    emailVerified: !!payload.email_verified,
    exp: Number(payload.exp ?? 0),
    raw: token,
  };
}

/**
 * Hash a password using PBKDF2-SHA256 (Web Crypto API, available in Workers).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 100000,
    },
    keyMaterial,
    256
  );

  const hashHex = [...new Uint8Array(derivedBits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, expectedHash] = stored.split(":");
  if (!saltHex || !expectedHash) return false;

  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 100000,
    },
    keyMaterial,
    256
  );

  const hashHex = [...new Uint8Array(derivedBits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex === expectedHash;
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
