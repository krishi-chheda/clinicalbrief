// URL <-> view mapping. The URL is the source of truth, so refresh, back/forward and shared links work.
export type View =
  | "landing" | "login" | "dashboard" | "patients" | "patient" | "upload" | "search" | "audit" | "settings" | "admin"
  | "review" | "governance" | "ops"
  // Public information pages (no sign-in) and the not-found page
  | "about" | "security" | "data" | "roadmap" | "legal" | "docs" | "contact" | "notfound";

export interface Route {
  view: View;
  patientId?: string;
  docId?: string;
}

const PATHS: Record<Exclude<View, "patient">, string> = {
  landing: "/", login: "/login", dashboard: "/dashboard", patients: "/patients", upload: "/upload",
  search: "/search", audit: "/audit", settings: "/settings", admin: "/imports",
  review: "/review", governance: "/governance", ops: "/ops",
  about: "/about", security: "/security", data: "/data", roadmap: "/roadmap", legal: "/legal", docs: "/docs", contact: "/contact", notfound: "/404",
};
const VIEWS: Record<string, View> = Object.fromEntries(
  Object.entries(PATHS).map(([view, path]) => [path.slice(1), view as View]));

export const PUBLIC_VIEWS: View[] = ["landing", "login"];
// Information pages: public, and shown as-is to signed-in users too (no redirect to the dashboard).
export const INFO_VIEWS: View[] = ["about", "security", "data", "roadmap", "legal", "docs", "contact", "notfound"];

export function parseRoute(pathname: string): Route {
  const [first = "", second, third, fourth] = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === "patients" && second) {
    return { view: "patient", patientId: second, docId: third === "notes" ? fourth : undefined };
  }
  if (!first) return { view: "landing" };
  return { view: VIEWS[first] ?? "notfound" };
}

export const pathFor = (view: Exclude<View, "patient">) => PATHS[view];
export const patientPath = (patientId: string, docId?: string) =>
  `/patients/${encodeURIComponent(patientId)}${docId ? `/notes/${encodeURIComponent(docId)}` : ""}`;
