import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";
import { buildCsp } from "@/lib/csp";

// Next 16 renamed middleware to proxy (same behaviour). Per request: a fresh CSP nonce (Next reads it from the request's
// Content-Security-Policy header and puts it on its scripts), then the Supabase session cookie refresh.
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = await createClient(request, headers);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      // Link prefetches don't render HTML that runs scripts, and skipping them keeps prefetching cheap.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
