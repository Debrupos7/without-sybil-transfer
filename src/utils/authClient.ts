// ============================================================================
// authClient.ts — Worker-based auth (replaces Supabase Auth)
// ----------------------------------------------------------------------------
// All authentication goes through the Cloudflare Worker. JWT is stored in
// localStorage and attached to every API request.
// ============================================================================

"use client";

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/+$/, "");

export type AuthUser = {
  id: string;
  email: string;
};

const TOKEN_KEY = "sybil_transfer_token";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Auth API calls
// ---------------------------------------------------------------------------
export async function authSignUp(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  if (!WORKER_URL) throw new Error("NEXT_PUBLIC_WORKER_URL is not set");

  const res = await fetch(`${WORKER_URL}/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Sign up failed");
  }

  setToken(data.token);
  return { token: data.token, user: data.user };
}

export async function authSignIn(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  if (!WORKER_URL) throw new Error("NEXT_PUBLIC_WORKER_URL is not set");

  const res = await fetch(`${WORKER_URL}/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Sign in failed");
  }

  setToken(data.token);
  return { token: data.token, user: data.user };
}

export async function authGetMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token || !WORKER_URL) return null;

  try {
    const res = await fetch(`${WORKER_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      removeToken();
      return null;
    }

    const data = await res.json();
    return data.user;
  } catch {
    removeToken();
    return null;
  }
}

export function authSignOut(): void {
  removeToken();
}
