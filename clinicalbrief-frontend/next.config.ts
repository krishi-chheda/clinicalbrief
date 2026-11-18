// S-1 (security audit 2026-10-19): browser security headers for every page, and no X-Powered-By.
// The content security policy is per request (it carries a nonce), so it is set in src/proxy.ts (src/lib/csp.ts).
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// N-39: a production build without these would ship a CSP that blocks every API / sign-in call. Fail the build instead.
if (!dev && (!process.env.NEXT_PUBLIC_API_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error("NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SUPABASE_URL must be set for a production build (they define the CSP).");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    },
    // F-02: the service worker must never be served stale, or a new deploy is never seen.
    { source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
};

// withSerwist keeps esbuild (used to bundle the service worker, src/app/serwist/[path]/route.ts) out of the server bundle.
export default withSerwist(nextConfig);
