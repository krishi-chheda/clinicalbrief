import type { Metadata } from "next";
import { connection } from "next/server";

// Every path resolves here so deep links work; the app itself is mounted once in the root layout
// and reads the view from the URL (see src/lib/routes.ts). This page only supplies the tab title.
//
// F-02 GUARD: the service worker stores page documents on the device (src/lib/pwa/cache-policy.ts). That is safe only
// because this page renders NOTHING user-specific: patient data is fetched in the browser from the API, which is never
// stored. If a route ever server-renders patient or user data, add its path to PRIVATE_PREFIXES in cache-policy.ts.
const TITLES: Record<string, string> = {
  "": "The reviewed record for clinical notes", login: "Sign in", about: "About", security: "Security and privacy",
  data: "Data and licences", roadmap: "Roadmap", legal: "Disclaimer and terms", docs: "Developer docs", contact: "Contact",
  dashboard: "Dashboard", patients: "Patients", upload: "Upload", search: "Search records", audit: "Audit log",
  settings: "Settings", offline: "Offline", imports: "Imports", review: "Review queue", governance: "Governance", ops: "System health",
};

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const [first = "", second] = (await params).slug ?? [];
  const title = first === "patients" && second ? "Patient" : TITLES[first] ?? "Page not found";
  return { title: `${title} · ClinicalBrief` };
}

// Rendered per request: the CSP nonce (src/proxy.ts) can only be applied to a dynamically rendered page.
// /offline is precached by the service worker and answers pages never opened on this device; the marker tells the app
// (ClinicalBriefApp) to show the offline state whatever the URL is.
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  await connection();
  const [first] = (await params).slug ?? [];
  return first === "offline" ? <div id="cb-offline-fallback" hidden /> : null;
}
