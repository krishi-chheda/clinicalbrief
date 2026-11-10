import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// `headers`: the request headers to pass on to rendering (the proxy adds the CSP nonce to them).
export const createClient = async (request: NextRequest, headers: Headers = new Headers(request.headers)) => {
  let supabaseResponse = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          headers.set("cookie", request.headers.get("cookie") ?? "");  // refreshed cookies, nonce headers kept
          supabaseResponse = NextResponse.next({ request: { headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    },
  );

  // Required: validates the session and writes refreshed auth cookies onto the response.
  await supabase.auth.getUser();

  return supabaseResponse
};
