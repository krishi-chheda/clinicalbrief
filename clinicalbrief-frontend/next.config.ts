// S-1 (security audit 2026-10-19): browser security headers for every page, and no X-Powered-By.
// The CSP allows exactly what the site uses: itself, Google Fonts, the API and Supabase (HTTPS + realtime websocket),
// and Cloudflare Turnstile for the demo CAPTCHA. No page may be framed by another site (clickjacking).
// Next.js injects small inline bootstrap scripts without a nonce, hence 'unsafe-inline' for scripts; development also
// needs 'unsafe-eval' and a websocket for hot reload.
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// N-39: a production build without these would ship a CSP that blocks every API / sign-in call. Fail the build instead.
if (!dev && (!process.env.NEXT_PUBLIC_API_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error("NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SUPABASE_URL must be set for a production build (they define the CSP).");
}
const origin = (url?: string) => { try { return url ? new URL(url).origin : ""; } catch { return ""; } };
const api = origin(process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8000";
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  ["connect-src 'self'", api, dev && "http://127.0.0.1:8000 ws://localhost:3000",
   supabase, supabase && supabase.replace(/^https:/, "wss:")].filter(Boolean).join(" "),
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
