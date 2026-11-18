/// <reference lib="esnext" />
/// <reference lib="webworker" />
// F-02 service worker (ported from Aurel), bundled by @serwist/turbopack (src/app/serwist/[path]/route.ts) and served
// at /serwist/sw.js with scope "/". What may be stored is decided by lib/pwa/cache-policy.ts; this file only maps
// policies to strategies. Records and API responses are never stored.
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";

import { CACHE_NAMES, cachePolicy, type CachePolicy } from "@/lib/pwa/cache-policy";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const is = (policy: CachePolicy) => ({ request, url }: { request: Request; url: URL }) =>
  cachePolicy({ url, destination: request.destination, method: request.method, isRsc: request.headers.get("RSC") === "1", origin: self.location.origin }) === policy;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // A new version waits until the user accepts it (components/pwa/UpdatePrompt.tsx), so a clinician's open session is
  // never switched to new code mid-task.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  // "network-only" requests (API, Supabase, non-GET, RSC) match no route, so the worker never answers them: the
  // browser fetches them exactly as if there were no worker, and nothing is stored.
  runtimeCaching: [
    { matcher: is("immutable"), handler: new CacheFirst({ cacheName: CACHE_NAMES.immutable, plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 })] }) },
    { matcher: is("assets"), handler: new StaleWhileRevalidate({ cacheName: CACHE_NAMES.assets, plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * 86400 })] }) },
    { matcher: is("pages"), handler: new NetworkFirst({ cacheName: CACHE_NAMES.pages, networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 48, maxAgeSeconds: 7 * 86400 })] }) },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

// The page posts SKIP_WAITING when the user accepts an update.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

serwist.addEventListeners();
