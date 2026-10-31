"use client";

import { useState } from "react";

import { ArrowRight, Loader2, Lock } from "@/components/icons";
import { safeRedirectPath } from "@/lib/safe-redirect";
import {
  authenticationResponseToJson,
  encodeRequestOptions,
  isCancellation,
} from "@/lib/webauthn-browser";
import { usePasskeysSupported } from "@/lib/use-passkeys-supported";

/**
 * "Sign in with a passkey".
 *
 * The button only appears once this browser has told us it can do WebAuthn —
 * rendering it to a browser that cannot would be a control that always fails,
 * and that is worse than no control. It is also hidden if the server says
 * passkeys are not configured for this address, which the options request
 * reports.
 *
 * Sign-in happens in two calls: ask the server for a challenge, let the
 * authenticator sign it, hand it back. Nothing about the account is known until
 * the signature checks out.
 */
export function PasskeySignInButton({ next }: { next: string }) {
  const supported = usePasskeysSupported();
  // Set only when the server refuses to issue a challenge: this address cannot
  // sign for a relying party, so offering the control would be a dead end.
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const optionsResponse = await fetch("/api/auth/passkey/options", { method: "POST" });
      const optionsBody = (await optionsResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        options?: Parameters<typeof encodeRequestOptions>[0];
        error?: string;
      };
      if (!optionsResponse.ok || !optionsBody.ok || !optionsBody.options) {
        setUnavailable(true);
        setError(optionsBody.error ?? "Passkeys are not available on this address.");
        return;
      }

      let credential: Credential | null;
      try {
        credential = await navigator.credentials.get({
          publicKey: encodeRequestOptions(optionsBody.options),
        });
      } catch (ceremonyError) {
        if (isCancellation(ceremonyError)) {
          setError("Passkey sign-in was cancelled.");
          return;
        }
        setError("That passkey could not be used. Try again, or sign in with your password.");
        return;
      }
      if (!credential) {
        setError("Passkey sign-in was cancelled.");
        return;
      }

      const verifyResponse = await fetch("/api/auth/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authenticationResponseToJson(credential as PublicKeyCredential) }),
      });
      const verifyBody = (await verifyResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!verifyResponse.ok || !verifyBody.ok) {
        setError(verifyBody.error ?? "That passkey did not work. Try again, or sign in with your password.");
        return;
      }
      window.location.replace(safeRedirectPath(next));
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if ((!supported || unavailable) && !error) return null;

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="btn w-full border border-line bg-white !py-3.5 text-ink shadow-sm hover:bg-lav-50/60 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Lock className="h-4 w-4 text-lav-600" />
        )}
        {pending ? "Waiting for your device…" : "Sign in with a passkey"}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>
      {error ? (
        <p role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-meta text-amber-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
