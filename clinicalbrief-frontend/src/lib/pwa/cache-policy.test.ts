// Run with `npm test` (Node's built-in test runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_NAMES, cachePolicy } from "./cache-policy.ts";

const origin = "https://clinicalbrief.vercel.app";
const req = (url: string, over: Partial<{ destination: string; method: string; isRsc: boolean }> = {}) =>
  cachePolicy({ url: new URL(url, origin), destination: "", method: "GET", isRsc: false, origin, ...over });

test("records and auth are never stored: API, Supabase, private paths", () => {
  assert.equal(req("https://clinicalbrief.onrender.com/api/v1/patients"), "network-only");
  assert.equal(req("https://clinicalbrief.onrender.com/api/v1/patients/1", { destination: "document" }), "network-only");
  assert.equal(req("https://bqjcirfecoxzoqbianqn.supabase.co/auth/v1/token"), "network-only");
  assert.equal(req("https://bqjcirfecoxzoqbianqn.supabase.co/rest/v1/patients"), "network-only");
  assert.equal(req("/api/anything"), "network-only");
  assert.equal(req("/serwist/sw.js"), "network-only");
});

test("non-GET and RSC are never stored", () => {
  assert.equal(req("/patients", { method: "POST", destination: "document" }), "network-only");
  assert.equal(req("/patients", { isRsc: true }), "network-only");
  assert.equal(req("/patients?_rsc=abc", { isRsc: true, destination: "document" }), "network-only");
});

test("shell: static assets, icons and documents", () => {
  assert.equal(req("/_next/static/chunks/app.js", { destination: "script" }), "immutable");
  assert.equal(req("/icons/icon-192.png", { destination: "image" }), "assets");
  assert.equal(req("https://fonts.gstatic.com/x.woff2", { destination: "font" }), "network-only"); // cross-origin
  assert.equal(req("/patients/1", { destination: "document" }), "pages");
  assert.equal(req("/manifest.webmanifest", { destination: "manifest" }), "network-only");
});

test("cache names", () => {
  assert.deepEqual(Object.values(CACHE_NAMES), ["clinicalbrief-static-v1", "clinicalbrief-assets-v1", "clinicalbrief-pages-v1"]);
});
