"use client";

import { useState } from "react";

/**
 * End the current session from the operator sign-in page.
 *
 * `/admin/login` is reachable while signed in, and a customer who follows a
 * console link sees the "not an administrator" notice there. Without a way to
 * sign out, that notice is a dead end: the form underneath would attempt to sign
 * in as somebody who is already signed in, and navigating to `/login` keeps the
 * same session and bounces straight back.
 *
 * A plain `<form action="/api/auth/logout" method="post">` does not work here:
 * that endpoint answers JSON for a fetch caller, so a form navigation would leave
 * the visitor staring at `{"ok":true}`. This posts the same request the sign-out
 * button in both shells uses, then reloads the page so the form is presented to
 * an anonymous visitor.
 */
export function SwitchAccount() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Sign out failed");
      // A full navigation, not a router push: the server has to re-render this
      // page against a request that no longer carries the session cookie.
      window.location.replace("/admin/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        className="btn w-full border border-line bg-white !py-3 text-ink shadow-sm hover:bg-lav-50/60 disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out and use a different account"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-center text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
