"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Shield, Sparkle } from "@/components/icons";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { BrandIcon } from "@/components/BrandIcon";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";

type Mode = "login" | "signup";

const GOOGLE_ERRORS: Record<string, string> = {
  "google-not-configured":
    "Google sign-in isn’t available yet. Please continue with your email and password.",
  "google-canceled": "Google sign-in was cancelled before it finished.",
  "google-state": "That Google sign-in link expired. Please start again.",
  "google-exchange": "Google couldn’t complete the sign-in. Please try again.",
  "google-account-exists": "An account already uses this email but is not linked to this Google identity. Sign in with your existing method or contact support for secure recovery.",
};

/**
 * Sign-in / sign-up card.
 *
 * Keep *conditional, request-dependent* markup OUT of this component. It is a
 * client component, so a browser holding an older bundle cannot render nodes
 * that were added here later — the server includes them, the client doesn't, and
 * React reports a hydration mismatch. That is not hypothetical: the "landed back
 * here" notice lived here and produced exactly that error on a stale tab.
 * Notices that depend on server-side state belong in the page (a server
 * component), where a stale bundle doesn't need to know about them.
 */
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
  const [pending, setPending] = useState<"form" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set only when the password was accepted and a second factor is required.
  // Kept in client state on purpose: the challenge token is single-use, short
  // lived and bound to this sign-in attempt, so it must not go in a URL or a
  // cookie the browser might replay later.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

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
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        twoFactorRequired?: boolean;
        challengeToken?: string;
      };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That didn't work. Please try again.");
        setPending(null);
        return;
      }
      if (data.twoFactorRequired && data.challengeToken) {
        setChallenge(data.challengeToken);
        setPending(null);
        return;
      }
      window.location.replace(safeRedirectPath(next));
      return;
    } catch {
      setError("Network hiccup. Please try again.");
      setPending(null);
    }
  }

  async function verifySecondFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setPending("form");
    setError(null);
    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: challenge, code }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That code did not work.");
        setPending(null);
        return;
      }
      window.location.replace(safeRedirectPath(next));
      return;
    } catch {
      setError("Network hiccup. Please try again.");
      setPending(null);
    }
  }

  if (challenge) {
    return (
      <div>
        <span className="eyebrow">
          <Shield className="h-3 w-3" />
          Two-step verification
        </span>
        <h1 className="mt-3 text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.3rem]">
          Enter the code from
          <br />
          <span className="text-display italic text-lav-700">your authenticator.</span>
        </h1>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-2">
          Your password was accepted. This sign-in needs the six-digit code, or one of your saved
          recovery codes.
        </p>

        <form onSubmit={verifySecondFactor} className="mt-5 grid gap-3.5">
          <div>
            <label htmlFor="two-factor-code" className="field-label">
              Code or recovery code
            </label>
            <input
              id="two-factor-code"
              autoFocus
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              className="field"
              placeholder="123456 or abcde-fghij"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-meta font-medium text-red-700">
              {error}
            </p>
          )}

          <button type="submit" disabled={pending !== null || code.length < 6} className="btn btn-primary w-full !py-3.5">
            {pending ? "Checking…" : "Continue"}
            {!pending && <ArrowRight className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
            className="text-meta font-semibold text-ink-2 underline underline-offset-2"
          >
            Start over
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        {errorParam && GOOGLE_ERRORS[errorParam] && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-meta font-medium text-amber-800">
            {GOOGLE_ERRORS[errorParam]}
          </p>
        )}

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
            ? "Create an account to buy number plans and track every order in one dashboard."
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
          <PasswordInput
            id="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
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

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-micro font-semibold uppercase tracking-[0.16em] text-ink-3">
          {mode === "signup" ? "or sign up with" : "or sign in with"}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="grid gap-2.5">
        {/* A passkey only exists after an account does, so this is a sign-in
            control and never a sign-up one. */}
        {mode === "login" ? <PasskeySignInButton next={next} /> : null}
        <a
          href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          className="btn w-full border border-line bg-white !py-3.5 text-ink shadow-sm hover:bg-lav-50/60"
        >
          {/* Google's own four-colour G, from the same brand-mark table the
              service pages use — never our mark, and never redrawn by hand. */}
          <BrandIcon brand="google" variant="bare" size={18} decorative />
          Continue with Google
        </a>
      </div>

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

      <p className="mt-6 flex items-start gap-2 rounded-xl bg-lav-50/80 px-3.5 py-3 text-meta leading-relaxed text-ink-2">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-lav-600" />
        Passwords are stored salted and hashed. Pryva never asks for your BVN, bank login or OTP from
        other platforms.
      </p>

      {mode === "signup" && (
        <ul className="mt-4 grid gap-1.5">
          {["Pay in Naira by transfer or card", "Live fulfillment for several services is paused", "Support for delivery issues"].map(
            (item) => (
              <li key={item} className="flex items-center gap-2 text-meta text-ink-2">
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
