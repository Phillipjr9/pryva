"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Shield, Sparkle } from "@/components/icons";
import { BrandMark } from "@/components/brand/BrandMark";

type Mode = "login" | "signup";

const GOOGLE_ERRORS: Record<string, string> = {
  "google-not-configured":
    "Google sign-in isn’t configured on this preview yet — the site owner needs to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  "google-canceled": "Google sign-in was cancelled before it finished.",
  "google-state": "That Google sign-in link expired. Please start again.",
  "google-exchange": "Google couldn’t complete the sign-in. Please try again.",
  "demo-failed": "The demo could not open right now. Please try again in a moment.",
};

export function AuthForm({
  mode,
  next,
  errorParam,
}: {
  mode: Mode;
  next: string;
  errorParam?: string | null;
}) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [pending, setPending] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("form");
    setError(null);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload =
        mode === "signup"
          ? { name: form.name, email: form.email, password: form.password }
          : { email: form.email, password: form.password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That didn't work. Please try again.");
        setPending(null);
        return;
      }
      window.location.replace(next);
      return;
    } catch {
      setError("Network hiccup. Please try again.");
      setPending(null);
    }
  }

  async function submitDemo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("demo");
    setError(null);
    try {
      const response = await fetch("/api/auth/demo", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "The demo could not open right now. Please try again.");
        setPending(null);
        return;
      }
      window.location.replace(next);
    } catch {
      setError("Network hiccup. Please try again.");
      setPending(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        {errorParam && GOOGLE_ERRORS[errorParam] && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[0.78rem] font-medium text-amber-800">
            {GOOGLE_ERRORS[errorParam]}
          </p>
        )}

        <a
          href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          className="btn w-full border border-line bg-white !py-3.5 text-ink shadow-sm hover:bg-lav-50/60"
        >
          <BrandMark name="Google" className="h-4.5 w-4.5" />
          Continue with Google
        </a>

        <form
          action="/api/auth/demo-web"
          method="post"
          onSubmit={submitDemo}
          className="mt-2.5"
        >
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            disabled={pending !== null}
            className="btn w-full border border-transparent bg-lav-100 !py-3.5 !text-[0.85rem] text-lav-800 hover:bg-lav-200/80 disabled:opacity-60"
          >
            <Sparkle className="h-4 w-4" />
            {pending === "demo" ? "Opening the demo…" : "Try the live demo — no signup"}
          </button>
        </form>
        <p className="mt-2 text-center text-[0.7rem] text-ink-3">
          Demo starts signed in with ₦25,000 wallet credit.
        </p>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
            or with email
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <span className="eyebrow">
          <Sparkle className="h-3 w-3" />
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </span>
        <h1 className="mt-3 text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.3rem]">
          {mode === "signup" ? (
            <>
              Start using Pryva
              <br />
              <span className="text-display italic text-lav-700">in about a minute.</span>
            </>
          ) : (
            <>
              Sign in to your
              <br />
              <span className="text-display italic text-lav-700">Pryva dashboard.</span>
            </>
          )}
        </h1>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-2">
          {mode === "signup"
            ? "No documents, no waiting list. New preview accounts are credited with ₦5,000 to try a real purchase."
            : "Your wallet, orders, codes and refunds are waiting exactly where you left them."}
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3.5">
        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="field-label">
              Full name
            </label>
            <input
              id="name"
              required
              minLength={2}
              autoComplete="name"
              className="field"
              placeholder="Amaka Obi"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="field-label">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="field"
            placeholder="you@example.com"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="field"
            placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </div>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[0.8rem] font-medium text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending !== null}
          className="btn btn-primary mt-1 w-full !py-3.5 disabled:opacity-60"
        >
          {pending === "form"
            ? mode === "signup"
              ? "Creating your account…"
              : "Signing in…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
          {pending !== "form" && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      <p className="mt-6 text-center text-[0.85rem] text-ink-2">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-lav-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Pryva?{" "}
            <Link href="/signup" className="font-semibold text-lav-700 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>

      <p className="mt-6 flex items-start gap-2 rounded-xl bg-lav-50/80 px-3.5 py-3 text-[0.74rem] leading-relaxed text-ink-2">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-lav-600" />
        Passwords are stored salted and hashed. Pryva never asks for your BVN, bank login or OTP from
        other platforms.
      </p>

      {mode === "signup" && (
        <ul className="mt-4 grid gap-1.5">
          {["Pay in Naira by transfer or card", "Instant delivery on every service", "Auto-refund if a code doesn't arrive"].map(
            (item) => (
              <li key={item} className="flex items-center gap-2 text-[0.76rem] text-ink-2">
                <Check className="h-3.5 w-3.5 text-lav-600" />
                {item}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
