"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "pryva_cookie_consent";
const CONSENT_VERSION = "2026-11-06";

type ConsentState = {
  accepted: boolean;
  version: string;
  createdAt: string;
};

function subscribeConsent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("pryva-cookie-consent", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pryva-cookie-consent", onChange);
  };
}

function readConsent(): string {
  try { return window.localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function CookieConsentBanner() {
  // The server cannot read browser storage; a separate server snapshot prevents
  // a consent flash and hydration mismatch. The string is stable for React.
  const raw = useSyncExternalStore(subscribeConsent, readConsent, () => "server");
  const [dismissed, setDismissed] = useState(false);
  let saved: Partial<ConsentState> | null = null;
  try { if (raw && raw !== "server") saved = JSON.parse(raw); } catch { /* ask again */ }
  const valid = saved !== null && typeof saved.accepted === "boolean";

  useEffect(() => {
    if (!raw || raw === "server") return;
    try {
      const consent = JSON.parse(raw) as Partial<ConsentState>;
      if (typeof consent?.accepted !== "boolean") return;
      document.documentElement.dataset.cookieConsent = consent.accepted ? "accepted" : "declined";
      if (consent.accepted) {
        window.dispatchEvent(new CustomEvent("pryva-cookie-consent", {
          detail: { accepted: true, createdAt: consent.createdAt },
        }));
      }
    } catch { /* invalid saved consent is treated as unanswered */ }
  }, [raw]);

  const saveConsent = (accepted: boolean) => {
    if (typeof window === "undefined") return;

    const payload: ConsentState = {
      accepted,
      version: CONSENT_VERSION,
      createdAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(
        new CustomEvent("pryva-cookie-consent", {
          detail: { accepted, createdAt: payload.createdAt, version: payload.version },
        }),
      );
      document.documentElement.dataset.cookieConsent = accepted ? "accepted" : "declined";
    } catch {
      // Ignore storage failures so the site still works if a browser blocks storage.
    }

    setDismissed(true);
  };

  if (raw === "server" || valid || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 px-4 py-4 shadow-[0_-12px_40px_rgba(18,16,12,0.12)] backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[0.96rem] font-semibold text-ink">We use cookies to keep your session secure and remember your consent.</p>
          <p className="mt-1 text-[0.82rem] leading-relaxed text-ink-2">
            Essential session cookies keep you signed in and protect authentication. We also remember your consent choice in the browser so you are not asked again.
            Review the <Link href="/cookie-policy" className="font-semibold text-lav-700 underline underline-offset-2">Cookie policy</Link> and <Link href="/privacy" className="font-semibold text-lav-700 underline underline-offset-2">Privacy policy</Link>.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => saveConsent(true)}
            className="rounded-xl bg-lav-700 px-4 py-2.5 text-[0.82rem] font-semibold text-white transition-colors hover:bg-lav-800"
          >
            Yes, I accept
          </button>
          <button
            type="button"
            onClick={() => saveConsent(false)}
            className="rounded-xl border border-line bg-white px-4 py-2.5 text-[0.82rem] font-semibold text-ink transition-colors hover:border-lav-300 hover:text-lav-700"
          >
            Only essentials
          </button>
        </div>
      </div>
    </div>
  );
}
