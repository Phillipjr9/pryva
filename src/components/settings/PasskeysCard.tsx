"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AlertCircle, CheckCircle, Loader2, Lock, Trash2 } from "@/components/icons";
import type { CredentialSummary } from "@/lib/passkeys";
import {
  encodeCreationOptions,
  isCancellation,
  registrationResponseToJson,
} from "@/lib/webauthn-browser";
import { usePasskeysSupported } from "@/lib/use-passkeys-supported";

type Props = {
  passkeys: CredentialSummary[];
  /** False when this address cannot run WebAuthn (no pinned HTTPS origin, plain HTTP). */
  available: boolean;
};

/**
 * Add, list and remove passkeys.
 *
 * The list is the account's own and nothing else: the server filters by session
 * before this component is rendered, and the delete call carries only an id,
 * which the server scopes to the account inside the query.
 *
 * "Add a passkey" is hidden — with the reason stated — when this address cannot
 * run a ceremony, and when the browser has no WebAuthn support. A button that
 * always fails teaches a customer the feature is broken.
 */
export function PasskeysCard({ passkeys, available }: Props) {
  const router = useRouter();
  const supported = usePasskeysSupported();
  const [pending, setPending] = useState<"add" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function addPasskey() {
    if (pending) return;
    setPending("add");
    setError(null);
    setNotice(null);
    try {
      const optionsResponse = await fetch("/api/security/passkeys/options", { method: "POST" });
      const optionsBody = (await optionsResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        options?: Parameters<typeof encodeCreationOptions>[0];
        error?: string;
      };
      if (!optionsResponse.ok || !optionsBody.ok || !optionsBody.options) {
        setError(optionsBody.error ?? "Could not start adding a passkey.");
        return;
      }

      let credential: Credential | null;
      try {
        credential = await navigator.credentials.create({
          publicKey: encodeCreationOptions(optionsBody.options),
        });
      } catch (ceremonyError) {
        setError(
          isCancellation(ceremonyError)
            ? "Adding a passkey was cancelled."
            : "Your device could not create a passkey. Try again, or use a different device.",
        );
        return;
      }
      if (!credential) {
        setError("Adding a passkey was cancelled.");
        return;
      }

      const deviceName =
        typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent)
          ? "This phone"
          : "This device";

      const verifyResponse = await fetch("/api/security/passkeys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: registrationResponseToJson(credential as PublicKeyCredential),
          label: deviceName,
        }),
      });
      const verifyBody = (await verifyResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!verifyResponse.ok || !verifyBody.ok) {
        setError(verifyBody.error ?? "That passkey could not be saved.");
        return;
      }
      setNotice("Passkey added. You can use it the next time you sign in.");
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function removePasskey(id: string, label: string) {
    if (pending) return;
    setPending(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/security/passkeys/${id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Could not remove that passkey.");
        return;
      }
      setNotice(`${label} removed.`);
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const canAdd = available && supported;

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[0.9rem] font-semibold text-ink">
            <Lock className="h-4 w-4 text-lav-600" /> Passkeys
          </p>
          <p className="mt-1 text-meta leading-relaxed text-ink-2">
            Sign in with your fingerprint, face or device PIN instead of typing a password. The key stays on
            your device — there is nothing on our side for anyone to steal.
          </p>
        </div>
      </div>

      {passkeys.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/40 px-3 py-2.5 text-meta text-ink-3">
          No passkeys yet.
        </p>
      ) : (
        <ul className="mt-3 grid gap-1.5">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-[#fffdfa] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-meta font-semibold text-ink">
                  {passkey.label}
                  {passkey.backedUp ? (
                    <span className="ml-1.5 rounded-full bg-lav-50 px-1.5 py-0.5 text-micro font-medium text-lav-700">
                      synced
                    </span>
                  ) : null}
                </p>
                <p className="text-micro text-ink-3">
                  Added{" "}
                  {new Date(passkey.createdAt).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {passkey.lastUsedAt
                    ? ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}`
                    : " · not used yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void removePasskey(passkey.id, passkey.label)}
                disabled={pending !== null}
                aria-label={`Remove ${passkey.label}`}
                className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-ink-2 hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
              >
                {pending === passkey.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 text-meta font-medium text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 flex items-start gap-1.5 text-meta font-medium text-emerald-700">
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}
        </p>
      ) : null}

      {canAdd ? (
        <button
          type="button"
          onClick={() => void addPasskey()}
          disabled={pending !== null}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
        >
          {pending === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {pending === "add" ? "Waiting for your device…" : "Add a passkey"}
        </button>
      ) : (
        <p className="mt-3 text-micro leading-relaxed text-ink-3">
          {!available
            ? "Passkeys need a secure site address (HTTPS). They will appear here once this deployment is served on its own domain."
            : "This browser cannot create passkeys. Try a current Chrome, Safari or Edge on a device with a screen lock."}
        </p>
      )}
    </div>
  );
}
