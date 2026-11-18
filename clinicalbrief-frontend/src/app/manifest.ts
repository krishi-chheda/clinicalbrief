import type { MetadataRoute } from "next";

// F-02: Web App Manifest (served at /manifest.webmanifest). Icons are generated from src/app/icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ClinicalBrief",
    short_name: "ClinicalBrief",
    description: "Research prototype on synthetic data: clinical notes turned into a reviewed record. Not a medical device.",
    // No query string: stored documents are keyed by exact URL, so "/dashboard?source=pwa" would never match a stored
    // "/dashboard" on an offline launch (Aurel PWA-05). Signed-out launches show the sign-in page and continue here.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F4FAED",
    theme_color: "#18280E",
    categories: ["medical", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
