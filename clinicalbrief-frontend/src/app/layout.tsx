import type { Metadata } from "next";
import "./globals.css";
import ClinicalBriefApp from "./ClinicalBriefApp";

export const metadata: Metadata = {
  title: "ClinicalBrief · The reviewed record for clinical notes",
  description: "Research prototype on synthetic data: clinical notes turned into a reviewed, searchable and FHIR-exportable record. Not a medical device.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        {/* Mounted once here, not in the page: a page remounts whenever its URL segment changes,
            which threw away all loaded data on every Dashboard <-> Patients switch. */}
        <ClinicalBriefApp />
        {children}
      </body>
    </html>
  );
}
