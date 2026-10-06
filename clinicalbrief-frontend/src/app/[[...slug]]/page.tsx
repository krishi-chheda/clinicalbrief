import type { Metadata } from "next";

// Every path resolves here so deep links work; the app itself is mounted once in the root layout
// and reads the view from the URL (see src/lib/routes.ts). This page only supplies the tab title.
const TITLES: Record<string, string> = {
  "": "The reviewed record for clinical notes", login: "Sign in", about: "About", security: "Security and privacy",
  data: "Data and licences", roadmap: "Roadmap", legal: "Disclaimer and terms", docs: "Developer docs", contact: "Contact",
  dashboard: "Dashboard", patients: "Patients", upload: "Upload", search: "Search records", audit: "Audit log",
  settings: "Settings", imports: "Imports", review: "Review queue", governance: "Governance", ops: "System health",
};

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const [first = "", second] = (await params).slug ?? [];
  const title = first === "patients" && second ? "Patient" : TITLES[first] ?? "Page not found";
  return { title: `${title} · ClinicalBrief` };
}

export default function Page() {
  return null;
}
