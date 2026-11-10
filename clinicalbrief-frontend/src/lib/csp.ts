// Content security policy, built per request by src/proxy.ts (v1.0.1, N-41).
// Scripts run only if they carry this request's nonce (Next adds it to its own scripts during server rendering) or were
// loaded by such a script ('strict-dynamic', which is how the Turnstile script gets in). No 'unsafe-inline' for scripts.
// Styles keep 'unsafe-inline': GSAP and React set style attributes, which a nonce cannot cover.
const origin = (url?: string) => { try { return url ? new URL(url).origin : ""; } catch { return ""; } };

export function buildCsp(nonce: string, dev: boolean): string {
  const api = origin(process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8000";
  const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
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
}
