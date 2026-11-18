"use client";
// F-02: registers the service worker (/serwist/sw.js, scope "/") and shows the update prompt. Off in `next dev` so
// stale caches never confuse development; set NEXT_PUBLIC_SW_DEV=true to try it there.
import { SerwistProvider } from "@serwist/turbopack/react";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

const disabled = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SW_DEV !== "true";

export function PwaProvider({ children }: { children: React.ReactNode }) {
  return (
    // reloadOnOnline would reload when the connection returns and lose unsaved input (a review edit, a Copilot question).
    <SerwistProvider swUrl="/serwist/sw.js" disable={disabled} reloadOnOnline={false}>
      {children}
      {!disabled && <UpdatePrompt />}
    </SerwistProvider>
  );
}

/**
 * A new deploy installs a worker that waits (sw.ts: skipWaiting false), so an open session is never switched to new
 * code mid-task. Without this prompt it would only take over once every tab and app window closed. "Reload" activates
 * it and reloads once it controls the page.
 */
function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    // Only an update counts: on a first install there is no controller and nothing to replace.
    const check = () => { if (reg?.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting); };
    const onFound = () => reg?.installing?.addEventListener("statechange", check);
    // Installed apps stay open for days; look for a new deploy whenever the app comes back to the foreground.
    const onVisible = () => { if (document.visibilityState === "visible") reg?.update().catch(() => {}); };
    navigator.serviceWorker.ready.then((r) => {
      reg = r;
      check();
      r.addEventListener("updatefound", onFound);
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      reg?.removeEventListener("updatefound", onFound);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!waiting) return null;
  const update = () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
  return (
    <div role="status" className="fixed inset-x-4 top-3 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 pl-4 text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <RefreshCw size={18} className="shrink-0 text-[#3F7308]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">A new version of ClinicalBrief is ready. Finish what you&apos;re typing first.</p>
      <button type="button" onClick={update} className="rounded-lg bg-[#18280E] px-3 py-1.5 text-sm font-semibold text-white">Reload</button>
    </div>
  );
}
