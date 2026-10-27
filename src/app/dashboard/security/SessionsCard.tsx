"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

function when(value: string) {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Device/session management. The API already existed but the screen showed
 * "Coming Soon", so nobody could see — or revoke — a stolen session.
 */
export function SessionsCard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/user/sessions", { cache: "no-store" });
      const data = (await response.json()) as { sessions?: Session[]; error?: string };
      if (response.ok) setSessions(data.sessions ?? []);
      else toast.error(data.error ?? "Could not load your sessions.");
    } catch {
      toast.error("Could not load your sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(sessionId?: string, all = false) {
    setBusy(sessionId ?? "all");
    try {
      const response = await fetch("/api/user/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { revokeAll: true } : { sessionId }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        toast.error(data.error ?? "Could not revoke that session.");
        return;
      }
      toast.success(all ? "Signed out everywhere else." : "Session signed out.");
      await load();
    } catch {
      toast.error("Could not revoke that session.");
    } finally {
      setBusy(null);
    }
  }

  const others = sessions.filter((session) => !session.isCurrent).length;

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[1rem] font-semibold text-ink">Active sessions</h3>
          <p className="mt-1 text-[0.84rem] text-ink-2">
            Every device currently signed in to your account.
          </p>
        </div>
        {others > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "all"}
            onClick={() => void revoke(undefined, true)}
          >
            Sign out other devices
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {loading && <p className="text-[0.82rem] text-ink-3">Loading…</p>}

        {!loading && sessions.length === 0 && (
          <p className="text-[0.82rem] text-ink-3">No active sessions found.</p>
        )}

        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cream/50 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-[0.82rem] font-medium text-ink">
                {session.isCurrent ? "This device" : "Another device"}
                {session.isCurrent && (
                  <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.66rem] font-semibold text-emerald-700">
                    Active now
                  </span>
                )}
              </p>
              <p className="text-[0.74rem] text-ink-3">
                Signed in {when(session.createdAt)} · expires {when(session.expiresAt)}
              </p>
            </div>
            {!session.isCurrent && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === session.id}
                onClick={() => void revoke(session.id)}
              >
                Sign out
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
