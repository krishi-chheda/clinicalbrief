"use client";
// App Router global error boundary: replaces the root layout when it fails, so it renders its own <html>/<body>
// and loads the global styles itself. Shows only a generic line plus the digest, never error.message or a stack.
import "./globals.css";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/public/StatusScreens";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en">
      <body>
        <ErrorScreen onRetry={reset}
          message={`The app hit an unexpected error. Try again, or head back home.${error.digest ? ` Reference: ${error.digest}` : ""}`} />
      </body>
    </html>
  );
}
