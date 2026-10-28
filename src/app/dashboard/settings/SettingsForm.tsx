"use client";

import { useState } from "react";
import { Check, Loader2, Lock, Shield, User } from "@/components/icons";
import type { PublicUser } from "@/lib/auth";
import { AccountDataPanel } from "./AccountDataPanel";

interface SettingsFormProps {
  user: PublicUser;
  sharedDemo?: boolean;
}

function Notice({ kind, children }: { kind: "error" | "success"; children: string }) {
  return (
    <p
      role="status"
      className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[0.78rem] font-medium ${
        kind === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <Check className="h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function Section({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: (props: { className?: string }) => React.ReactNode;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lav-50 text-lav-700">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[0.95rem] font-semibold">{title}</h2>
          <p className="mt-0.5 text-[0.78rem] text-ink-2">{note}</p>
        </div>
      </div>
      <div className="mt-3.5 grid gap-3">{children}</div>
    </section>
  );
}

/**
 * Account settings. Functionality is unchanged — this is the same two API calls
 * and the same validation — but it now uses the dashboard's field and button
 * styles instead of the older generic Card/Input set, which made this page look
 * like a different product.
 */
export function SettingsForm({ user, sharedDemo = false }: SettingsFormProps) {
  const [name, setName] = useState(user.name);
  const [savedDemoName, setSavedDemoName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleProfileUpdate() {
    setError(null);
    setSuccess(null);
    if (sharedDemo) {
      if (name.trim().length < 2 || name.trim().length > 120) {
        setError("Use a fictional name between 2 and 120 characters.");
      } else {
        setSavedDemoName(name.trim());
        setSuccess("Demo profile updated in this view only. The shared account is unchanged.");
      }
      return;
    }
    setSavingProfile(true);

    try {
      const response = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to update profile");
      setSuccess("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordChange() {
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSavingPassword(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to change password");
      setSuccess("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="grid gap-3.5">
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}

      <Section icon={User} title="Profile" note={sharedDemo ? "Try a fictional name. Changes stay in this view only." : "The name shown on orders and support replies."}>
        <div>
          <label htmlFor="profile-name" className="field-label">
            Name
          </label>
          <input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="field"
          />
        </div>
        <div>
          <label htmlFor="profile-email" className="field-label">
            Email
          </label>
          <input
            id="profile-email"
            value={user.email}
            disabled
            aria-describedby="profile-email-hint"
            className="field disabled:opacity-60"
          />
          <p id="profile-email-hint" className="mt-1 text-[0.7rem] text-ink-3">
            {sharedDemo ? "This address identifies the shared demo, not a personal inbox." : "Email can't be changed here — message support if you need to move accounts."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleProfileUpdate}
          disabled={savingProfile || name.trim() === (sharedDemo ? savedDemoName : user.name)}
          className="btn btn-primary w-fit !px-4 !py-2.5 !text-[0.8rem] disabled:opacity-50"
        >
          {savingProfile ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : (
            "Save profile"
          )}
        </button>
      </Section>

      {sharedDemo ? (
        <Section icon={Lock} title="Shared demo access" note="No password is needed for the shared demo. Do not enter real passwords or other secrets here.">
          <p className="text-[0.8rem] text-ink-2">Use Sign out to end your own session. Profile and security changes do not affect other visitors.</p>
        </Section>
      ) : <Section
        icon={Lock}
        title="Password"
        note="Use something you don't use anywhere else. At least 8 characters."
      >
        <div>
          <label htmlFor="current-password" className="field-label">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Current password"
            className="field"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="new-password" className="field-label">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="field-label">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat it"
              className="field"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handlePasswordChange}
          disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
          className="btn w-fit border border-ink bg-ink !px-4 !py-2.5 !text-[0.8rem] text-white hover:bg-ink/90 disabled:opacity-50"
        >
          {savingPassword ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Changing…
            </>
          ) : (
            "Change password"
          )}
        </button>
      </Section>}

      <Section icon={Shield} title="Account" note="Read-only details. Your data can be downloaded below.">
        <dl className="grid gap-2 text-[0.82rem] sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5">
            <dt className="text-ink-2">Member since</dt>
            <dd className="font-semibold text-ink">
              {new Date(user.createdAt).toLocaleDateString("en-NG", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5">
            <dt className="text-ink-2">Wallet balance</dt>
            <dd className="font-semibold text-ink">₦{user.walletBalance.toLocaleString()}</dd>
          </div>
        </dl>
      </Section>

      <AccountDataPanel sharedDemo={sharedDemo} />
    </div>
  );
}
