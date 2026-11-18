import { createSerwistRoute } from "@serwist/turbopack";

// F-02: builds and serves the service worker (/serwist/sw.js, with Service-Worker-Allowed: /). Served with
// Cache-Control: no-store (next.config.ts) so a new deploy is always seen.
// The revision versions the precached offline page, whose HTML names this build's script chunks. It must change on
// EVERY build: a git commit id did not (a rebuild or redeploy of the same commit kept the old page, which then asked for
// chunks the new build had removed). sw.js is prerendered once per build, so a random id is stable within a build.
const revision = crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/offline", revision }],
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  esbuildOptions: { sourcemap: false }, // no public source map in production
});
