"use client";

import { useState } from "react";
import { Shield } from "@/components/icons";
import { PasswordInput } from "@/components/ui/PasswordInput";

/**
 * Enrolment, recovery codes and disabling, for TOTP two-factor.
 *
 * The secret and the recovery codes are each shown **once** by the server and are
 * never returned again (the secret is encrypted at rest, the codes are hashed),
 * so this component makes the customer acknowledge both before moving on rather
 * than letting them click past the only copy that will ever exist.
 *
 * `available` comes from the server: without `TWO_FACTOR_KEY` the feature cannot
 * encrypt a secret, and the card says so instead of offering a button that fails.
 */
export function TwoFactorCard({
  initialEnabled,
  available,
  remainingCodes,
}: {
  initialEnabled: boolean;
  available: boolean;
  remainingCodes: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [phase, setPhase] = useState<"idle" | "setup" | "recovery" | "disable">("idle");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setSecret("");
    setUri("");
    setCode("");
    setPassword("");
    setRecoveryCodes([]);
    setSaved(false);
    setError(null);
  }

  async function call(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok && data.ok === true, data, message: typeof data.error === "string" ? data.error : null };
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      const result = await call("/api/security/2fa/start");
      if (!result.ok) {
        setError(result.message ?? "Could not start setup.");
        return;
      }
      setSecret(String(result.data.secret ?? ""));
      setUri(String(result.data.uri ?? ""));
      setPhase("setup");
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await call("/api/security/2fa/confirm", { code });
      if (!result.ok) {
        setError(result.message ?? "That code did not match.");
        return;
      }
      const codes = Array.isArray(result.data.recoveryCodes) ? result.data.recoveryCodes.map(String) : [];
      setRecoveryCodes(codes);
      setEnabled(true);
      setPhase("recovery");
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setPending(true);
    setError(null);
    try {
      const result = await call("/api/security/2fa/disable", { password, code });
      if (!result.ok) {
        setError(result.message ?? "Could not turn off two-factor authentication.");
        return;
      }
      setEnabled(false);
      setNotice("Two-factor authentication is off. Recovery codes have been deleted.");
      reset();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
          <Shield className="h-4 w-4" />
        </span>
        <span
          className={
            enabled
              ? "rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-micro font-semibold text-emerald-700"
              : "rounded-full border border-line bg-white px-2.5 py-1 text-micro font-semibold text-ink-3"
          }
        >
          {enabled ? "On" : available ? "Off" : "Not configured"}
        </span>
      </div>

      <h2 className="mt-3 text-[0.95rem] font-semibold">Two-factor authentication</h2>

      {notice && (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-meta text-emerald-800">
          {notice}
        </p>
      )}

      {!available && (
        <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">
          Not available on this deployment: the server has no encryption key configured for
          authenticator secrets, so turning it on would store them in a form we will not accept.
        </p>
      )}

      {available && phase === "idle" && error && (
        <p role="alert" className="mt-2 text-meta font-medium text-red-700">
          {error}
        </p>
      )}

      {available && phase === "idle" && (
        <>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">
            {enabled
              ? `Sign-in asks for a code from your authenticator app. ${remainingCodes} recovery code${remainingCodes === 1 ? "" : "s"} left.`
              : "Add a second step to sign-in: your password plus a rotating code from an authenticator app."}
          </p>
          {enabled ? (
            <button type="button" onClick={() => { setPhase("disable"); setError(null); }} className="mt-3 btn btn-ghost btn-sm">
              Turn off
            </button>
          ) : (
            <button type="button" onClick={start} disabled={pending} className="mt-3 btn btn-primary btn-sm">
              {pending ? "Starting…" : "Set up"}
            </button>
          )}
        </>
      )}

      {available && phase === "setup" && (
        <div className="mt-2 grid gap-3">
          <p className="text-[0.8rem] leading-relaxed text-ink-2">
            Add this key to your authenticator app (Google Authenticator, Authy, 1Password or any
            TOTP app), then enter the six-digit code it shows. <strong>This key is shown once.</strong>
          </p>
          <code className="block break-all rounded-lg border border-line bg-white px-3 py-2 font-mono text-[0.8rem] tracking-[0.12em]">
            {secret}
          </code>
          <details className="text-meta text-ink-2">
            <summary className="cursor-pointer font-semibold text-lav-700">Show setup link</summary>
            <p className="mt-1 break-all font-mono text-meta">{uri}</p>
          </details>
          <div>
            <label htmlFor="totp-code" className="field-label">Six-digit code</label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              className="field"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-meta font-medium text-red-700">{error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirm} disabled={pending || code.length < 6} className="btn btn-primary btn-sm">
              {pending ? "Checking…" : "Turn on"}
            </button>
            <button type="button" onClick={reset} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
        </div>
      )}

      {phase === "recovery" && (
        <div className="mt-2 grid gap-3">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-900">
            Save these now. They are the only way back in if you lose your authenticator, and they
            will never be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1.5 font-mono text-[0.8rem]">
            {recoveryCodes.map((value) => (
              <li key={value} className="rounded-lg border border-line bg-white px-2 py-1.5 text-center">{value}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-meta text-ink-2">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="mt-0.5" />
            I have saved these somewhere safe.
          </label>
          <button type="button" disabled={!saved} onClick={() => { reset(); setNotice("Two-factor authentication is on."); }} className="btn btn-primary btn-sm justify-self-start">
            Done
          </button>
        </div>
      )}

      {available && phase === "disable" && (
        <div className="mt-2 grid gap-3">
          <p className="text-[0.8rem] leading-relaxed text-ink-2">
            Turning this off deletes your recovery codes. Confirm with your password and a current
            code (or one recovery code).
          </p>
          <div>
            <label htmlFor="totp-password" className="field-label">Password</label>
            <PasswordInput
              id="totp-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="totp-disable-code" className="field-label">Code or recovery code</label>
            <input
              id="totp-disable-code"
              autoComplete="one-time-code"
              className="field"
              placeholder="123456 or abcde-fghij"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-meta font-medium text-red-700">{error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={disable} disabled={pending || !password || !code} className="btn btn-primary btn-sm">
              {pending ? "Turning off…" : "Turn off two-factor"}
            </button>
            <button type="button" onClick={reset} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
        </div>
      )}

    </section>
  );
}
