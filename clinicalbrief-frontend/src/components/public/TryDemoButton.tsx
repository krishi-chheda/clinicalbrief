// "Try the demo": anonymous Supabase sign-in into the read-only `demo` role (migration 0012), which sees only the
// flagged synthetic demo patients. When CAPTCHA is on in Supabase, NEXT_PUBLIC_TURNSTILE_SITE_KEY must be set: a
// Cloudflare Turnstile check runs first and its token goes with the sign-in. Without the key the sign-in is sent
// directly (fine while CAPTCHA is off, refused by Supabase once it is on).
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
    if (err) { setError(err); setState("idle"); }
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
    <span className="inline-flex flex-col items-center gap-2">
      <button type="button" onClick={click} disabled={state !== "idle"} className={`${className} disabled:opacity-70 disabled:cursor-wait`}>
        {state === "busy" ? "Starting the demo…" : state === "check" ? "Checking you're human…" : children}
      </button>
      <div ref={box} />
      {error && <p role="alert" className="max-w-xs text-center text-sm text-[#A1441B]">{error}</p>}
    </span>
  );
}
