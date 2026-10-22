import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

// Next 16 renamed middleware to proxy (same behaviour): refreshes the Supabase session cookie on each request.
export async function proxy(request: NextRequest) {
  return await createClient(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
