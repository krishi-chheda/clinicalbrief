// F-02: what the service worker (src/app/sw.ts) may store on the device. Pure, so it is unit-tested
// (cache-policy.test.ts, `npm test`); sw.ts only maps each policy to a Serwist strategy.
//
// Rules, most important first:
// - Anything cross-origin is never stored: the ClinicalBrief API (NEXT_PUBLIC_API_URL) and Supabase (auth, data).
//   Records and API responses therefore never reach the device's caches.
// - Non-GET requests and RSC payloads are never stored.
// - Page documents are stored network-first, for the offline shell. This is safe ONLY because no route renders
//   patient data on the server: src/app/[[...slug]]/page.tsx returns null and every record is fetched in the
//   browser from the API (cross-origin, never stored). A route that ever server-renders patient or user data
//   MUST be added to PRIVATE_PREFIXES.
// - Content-hashed build assets (/_next/static) are cache-first; icons, images and fonts stale-while-revalidate.

export type CachePolicy = "network-only" | "immutable" | "assets" | "pages";

export const PRIVATE_PREFIXES = ["/api/", "/auth/", "/serwist/"];

export const CACHE_NAMES = {
  immutable: "clinicalbrief-static-v1",
  assets: "clinicalbrief-assets-v1",
  pages: "clinicalbrief-pages-v1",
} as const;

export type CacheRequest = { url: URL; destination: string; method: string; isRsc: boolean; origin: string };

export function cachePolicy({ url, destination, method, isRsc, origin }: CacheRequest): CachePolicy {
  if (method !== "GET") return "network-only";
  if (url.origin !== origin) return "network-only";
  if (PRIVATE_PREFIXES.some((p) => url.pathname.startsWith(p))) return "network-only";
  if (url.pathname.startsWith("/_next/static/")) return "immutable";
  if (destination === "image" || destination === "font" || /\.(?:png|jpe?g|svg|ico|webp|woff2?)$/i.test(url.pathname)) return "assets";
  // RSC payloads carry a unique _rsc key, so storing them never hits and only evicts documents. Offline, a failed
  // RSC fetch makes Next.js fall back to a full page load, which a stored document (or the offline page) answers.
  if (isRsc) return "network-only";
  if (destination === "document") return "pages";
  return "network-only";
}

/** Delete the stored page documents. Called on every sign-out (shared clinical workstations). */
export async function clearPagesCache(): Promise<void> {
  if (typeof caches !== "undefined") await caches.delete(CACHE_NAMES.pages).catch(() => false);
}
