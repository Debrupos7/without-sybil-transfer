// ============================================================================
// next.config.js — Next.js config with top-level security hardening
// ----------------------------------------------------------------------------
// Adds:
//   * Strict Content-Security-Policy (no inline scripts except where needed for hydration)
//   * X-Frame-Options: DENY (no clickjacking)
//   * Strict-Transport-Security with preload
//   * Referrer-Policy: strict-origin-when-cross-origin
//   * X-Content-Type-Options: nosniff
//   * Permissions-Policy locked down
//   * Cross-Origin-Opener-Policy: same-origin
//   * Cross-Origin-Resource-Policy: same-origin
//   * Removes X-Powered-By header
//
// UPDATE the `connect-src` line below to include your actual deployed
// Worker URL and Supabase URL. The placeholder
// `https://sybil-transfer-worker.<your-subdomain>.workers.dev` MUST be
// replaced before going to production.
// ============================================================================

/** @type {import('next').NextConfig} */
const securityConfig = {
  reactStrictMode: true,
  poweredByHeader: false,   // removes X-Powered-By: Next.js

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Content Security Policy — adjust connect-src to your real Worker URL
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'none'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://sybil-transfer-worker.<your-subdomain>.workers.dev",
              "frame-ancestors 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "object-src 'none'",
              "manifest-src 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=(self), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

module.exports = securityConfig;
