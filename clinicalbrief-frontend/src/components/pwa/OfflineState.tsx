"use client";
// F-02: what a signed-in (or unvisited) page shows without a connection. Records are never stored on the device, so
// there is nothing to show offline: say so plainly instead of empty lists or generic errors.
import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  addEventListener("online", onChange);
  addEventListener("offline", onChange);
  return () => { removeEventListener("online", onChange); removeEventListener("offline", onChange); };
};

/** `false` is reliable (no network at all); `true` only means a network exists, so requests still handle failures. */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** `fallback`: the precached /offline page answered a page this device has never opened. */
export function OfflineState({ fallback = false }: { fallback?: boolean }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F4FAED] px-4 text-[#18280E]">
      <div role="status" className="w-full max-w-md rounded-2xl border border-[#B3C5A0] bg-white p-6 sm:p-8">
        <WifiOff size={28} className="text-[#3F7308]" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">{fallback ? "You're offline" : "You're offline: records need a connection"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#4A5B38]">
          {fallback ? "This page hasn't been opened on this device yet. " : ""}
          ClinicalBrief never stores patient records on this device, so they can&apos;t be shown offline. Public pages
          you have opened before still work. Reconnect and try again.
        </p>
        <button type="button" onClick={() => location.reload()}
          className="mt-6 rounded-lg bg-[#18280E] px-4 py-2 text-sm font-semibold text-white">Try again</button>
      </div>
    </main>
  );
}
