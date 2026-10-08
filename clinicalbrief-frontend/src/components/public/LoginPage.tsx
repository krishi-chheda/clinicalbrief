// Sign-in page: public-site header, a forest panel with what to expect, and the sign-in form.
// Contract below is fixed (ClinicalBriefApp passes these props).
import React, { useRef } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { useGSAP } from "@gsap/react";
import { SiteHeader, Mono } from "./kit";
import TryDemoButton from "./TryDemoButton";

gsap.registerPlugin(useGSAP, SplitText, DrawSVGPlugin);

// Motion: calm and premium (power3.out, 0.5-0.8 s). Everything runs only under prefers-reduced-motion:
// no-preference; otherwise the page is static and fully visible. The form is never hidden or delayed:
// the card only fades/rises from opacity 0 (still focusable and typable from the first frame).
const MOTION_OK = "(prefers-reduced-motion: no-preference)";
const ECG = "M0 60 H170 L185 60 L195 44 L205 60 L222 60 L232 70 L246 12 L260 104 L272 60 L292 60 L306 46 L322 60 H600";

export interface LoginPageProps {
  email: string;
  onEmailChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
  onTryDemo?: (captchaToken?: string) => Promise<string | null>;  // anonymous read-only demo (no account needed)
}

const POINTS = [
  "Synthetic data only. No real patient records are stored or processed.",
  "Every AI finding is reviewed by a person before it counts.",
  "Access is by role, assigned by an administrator. New accounts start with no access until one is granted.",
];

const ROLES = ["clinician", "consultant", "coder", "auditor", "researcher", "administrator"];

const INPUT = "mt-2 w-full rounded-md border border-[#B3C5A0] bg-white px-3.5 py-3 text-[15px] text-[#090F05] outline-none transition-[border-color,box-shadow] duration-200 hover:border-[#4A5B38] focus:border-[#3F7308] focus:ring-2 focus:ring-[#B2EB76]";

export default function LoginPage({ email, onEmailChange, password, onPasswordChange, onSubmit, error, onTryDemo }: LoginPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Entrance + ambient ECG loop.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from(".lg-card", { opacity: 0, y: 16, duration: 0.6, ease: "power3.out", clearProps: "transform" });
      SplitText.create(".lg-title", {
        type: "words", mask: "words", autoSplit: true,
        onSplit: self => gsap.from(self.words, { yPercent: 110, duration: 0.8, ease: "power3.out", stagger: 0.06 }),
      });
      gsap.from(".lg-point", { opacity: 0, y: 12, duration: 0.6, ease: "power3.out", stagger: 0.08, delay: 0.35 });
      gsap.timeline({ repeat: -1, repeatDelay: 1.2, delay: 0.6 })
        .fromTo(".lg-ecg", { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 2.4, ease: "sine.inOut" })
        .to(".lg-ecg", { drawSVG: "100% 100%", duration: 1.6, ease: "sine.inOut" });
    });
  }, { scope: rootRef });

  // Error feedback: short firm shake (no overshoot) and the alert fades in. Same message twice = no re-shake.
  useGSAP(() => {
    if (!error) return;
    gsap.matchMedia().add(MOTION_OK, () => {
      gsap.to(".lg-card", { keyframes: { x: [0, -8, 8, -6, 6, 0] }, duration: 0.36, ease: "none" });
      gsap.from(".lg-alert", { opacity: 0, y: -4, duration: 0.3, ease: "power3.out" });
    });
  }, { scope: rootRef, dependencies: [error] });

  return (
    <div ref={rootRef} className="lp bg-white text-[#090F05] min-h-screen">
      <SiteHeader />
      <main className="pt-16 min-h-screen grid md:grid-cols-2">
        <section className="relative overflow-hidden bg-[#18280E] text-white px-4 md:px-12 py-12 md:py-20 flex flex-col">
          <svg className="pointer-events-none absolute inset-x-0 bottom-20 h-24 w-full" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
            <path className="lg-ecg" d={ECG} fill="none" stroke="#B2EB76" strokeOpacity="0.22" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <Mono className="relative text-[#B3C5A0]">Workspace access</Mono>
          <h1 className="lg-title relative lp-display mt-5 text-[40px] leading-[1.03] md:text-[56px] tracking-[-0.02em] max-w-md">
            Sign in to the workspace<span className="text-[#B2EB76]">.</span>
          </h1>
          <ul className="relative mt-10 space-y-5 max-w-md">
            {POINTS.map((p, i) => (
              <li key={i} className="lg-point flex gap-4">
                <span className="lp-mono text-[13px] text-[#B2EB76] pt-0.5">0{i + 1}</span>
                <span className="text-[15px] leading-relaxed text-[#F4FAED]">{p}</span>
              </li>
            ))}
          </ul>
          <Mono className="relative mt-12 md:mt-auto pt-0 md:pt-12 text-[#B3C5A0]">Research prototype · not for clinical use</Mono>
        </section>

        <section className="lp-grid px-4 md:px-12 py-12 md:py-20 flex items-center justify-center">
          <div className="lg-card w-full max-w-md rounded-2xl border border-[#B3C5A0]/70 bg-white p-6 md:p-10 shadow-sm">
            <Mono className="text-[#4A5B38]">// Sign in</Mono>
            <h2 className="lp-display mt-3 text-3xl tracking-[-0.02em]">Welcome back</h2>
            <p className="mt-2 text-sm text-[#4A5B38] leading-relaxed">
              Use the account your administrator set up. Roles ({ROLES.join(", ")}) are assigned by an administrator.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div>
                <label htmlFor="login-email" className="lp-mono text-[12px] uppercase tracking-[0.12em] text-[#18280E]">Email</label>
                <input id="login-email" type="email" required autoComplete="email" placeholder="you@example.com"
                  value={email} onChange={e => onEmailChange(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="login-password" className="lp-mono text-[12px] uppercase tracking-[0.12em] text-[#18280E]">Password</label>
                <input id="login-password" type="password" required autoComplete="current-password"
                  value={password} onChange={e => onPasswordChange(e.target.value)} className={INPUT} />
              </div>
              {error && (
                <p role="alert" className="lg-alert rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{error}</p>
              )}
              <button type="submit"
                className="group w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#090F05] px-4 py-3.5 lp-mono text-[13px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#18280E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B2EB76] focus-visible:ring-offset-2">
                Sign in <ArrowRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
              </button>
            </form>

            {onTryDemo && (
              <div className="mt-6 border-t border-[#B3C5A0]/60 pt-6 text-center">
                <p className="text-sm text-[#4A5B38]">No account? Look around with 10 synthetic patients, read-only.</p>
                <div className="mt-3">
                  <TryDemoButton onStart={onTryDemo}
                    className="inline-flex items-center gap-2 rounded-md border border-[#18280E] px-4 py-2.5 lp-mono text-[13px] uppercase tracking-[0.12em] text-[#18280E] hover:bg-[#F4FAED]">
                    Try the demo
                  </TryDemoButton>
                </div>
              </div>
            )}

            <Link href="/" className="mt-8 inline-flex items-center gap-1.5 py-1.5 lp-mono text-[12px] uppercase tracking-[0.12em] text-[#4A5B38] hover:text-[#090F05]">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to the product page
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
