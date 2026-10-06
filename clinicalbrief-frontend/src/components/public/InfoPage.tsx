// Routes the public information pages. Each page lives in its own file in this folder.
import React from "react";
import type { View } from "../../lib/routes";
import AboutPage from "./AboutPage";
import SecurityPage from "./SecurityPage";
import DataPage from "./DataPage";
import RoadmapPage from "./RoadmapPage";
import LegalPage from "./LegalPage";
import DocsPage from "./DocsPage";
import ContactPage from "./ContactPage";
import NotFoundPage from "./NotFoundPage";

export default function InfoPage({ view }: { view: View }) {
  switch (view) {
    case "about": return <AboutPage />;
    case "security": return <SecurityPage />;
    case "data": return <DataPage />;
    case "roadmap": return <RoadmapPage />;
    case "legal": return <LegalPage />;
    case "docs": return <DocsPage />;
    case "contact": return <ContactPage />;
    default: return <NotFoundPage />;
  }
}
