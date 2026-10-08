// "Try the demo": anonymous Supabase sign-in into the read-only `demo` role (migration 0012), which sees only the
// flagged synthetic demo patients. When CAPTCHA is on in Supabase, NEXT_PUBLIC_TURNSTILE_SITE_KEY must be set: a
// Cloudflare Turnstile check runs first and its token goes with the sign-in. Without the key the sign-in is sent
// directly (fine while CAPTCHA is off, refused by Supabase once it is on).
// The check and any error float in a card under the button, so the surrounding row of buttons never changes size.
"use client";
import React, { useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Turnstile = { render: (el: HTMLElement, opts: Record<string, unknown>) => string };
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("turnstile")); };
    document.head.appendChild(s);
  });
  return loading;
}

// Supabase's raw messages are for developers; visitors get a plain sentence.
function friendly(message: string) {
  if (/captcha/i.test(message)) return "The demo's verification check isn't set up on this site yet. Please try again later.";
  return message;
}

export default function TryDemoButton({ onStart, className, children }: {
  onStart: (captchaToken?: string) => Promise<string | null>;  // resolves to an error message, or null on success
  className: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"idle" | "check" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const start = async (captchaToken?: string) => {
    setState("busy");
    const err = await onStart(captchaToken);
    if (err) { setError(friendly(err)); setState("idle"); }
  };

  const click = async () => {
    setError(null);
    if (!SITE_KEY) return start();
    setState("check");
    try {
      await loadTurnstile();
    } catch {
      setError("The verification check could not load. Check your connection and try again.");
      setState("idle");
      return;
    }
    box.current!.innerHTML = "";
    window.turnstile!.render(box.current!, {
      sitekey: SITE_KEY,
      callback: (token: string) => start(token),
      "error-callback": () => { setError("Verification failed. Please try again."); setState("idle"); },
    });
  };

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={click} disabled={state !== "idle"} className={`${className} disabled:opacity-70 disabled:cursor-wait`}>
        {state === "busy" ? "Starting the demo…" : state === "check" ? "Checking you're human…" : children}
      </button>
      {/* Always mounted (Turnstile renders into `box` right after the click); hidden until there is something to show. */}
      <span className={`${state === "check" || error ? "block" : "hidden"} absolute left-1/2 top-full z-20 mt-2 w-max max-w-[18rem] -translate-x-1/2 rounded-lg border border-[#B3C5A0] bg-white p-3 text-left shadow-[0_12px_32px_-12px_rgba(9,15,5,0.35)]`}>
        <span ref={box} className={state === "check" ? "block" : "hidden"} />
        {error && (
          <span role="alert" className="flex items-start gap-2 text-[13px] leading-snug text-[#7A3410]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C2410C]" />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="ml-1 text-[#4A5B38] hover:text-[#090F05]">×</button>
          </span>
        )}
      </span>
    </span>
  );
}
