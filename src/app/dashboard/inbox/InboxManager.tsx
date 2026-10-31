"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clock, Copy, Loader2, Mail, Plus, Refresh, Trash2 } from "@/components/icons";
import { EmptyState } from "@/components/dashboard/EmptyState";

type InboxView = {
  id: string;
  address: string;
  tier: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  discardedAt: string | null;
};

type MessageView = {
  subject: string | null;
  from: string | null;
  body: string | null;
  code: string | null;
  receivedAt: string | null;
};

/**
 * How often an open inbox checks itself for mail.
 *
 * Deliberately slow. Every check re-reads the whole mailbox from the source, and
 * that request budget is shared across every customer at once — so a brisk
 * auto-refresh here would be a way for one open tab to slow down everybody
 * else's orders. Fifteen seconds is quick enough to feel responsive while
 * waiting for a code and slow enough that a handful of open tabs cannot exhaust
 * it. Polling also stops when the tab is hidden, because a background tab has no
 * reason to spend a request nobody is looking at.
 */
const POLL_INTERVAL_MS = 15_000;

export function InboxManager() {
  const [inboxes, setInboxes] = useState<InboxView[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  // Guards against two polls overlapping, which would double the requests spent
  // and could put a slower response's older mailbox over a newer one.
  const inFlight = useRef(false);

  const active = inboxes.find((inbox) => inbox.status === "active") ?? null;

  /**
   * Bumping this key is how the list is re-read. Fetching inside the effect
   * rather than calling a shared loader keeps the effect body free of state
   * updates, which would otherwise cascade a render per call, and the
   * AbortController stops a slow response from landing over a newer one.
   */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    // The "loading" flip belongs to the click, not to the effect that follows it.
    setLoadState("loading");
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/inbox", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.error ?? "Could not load your inboxes.");
        if (controller.signal.aborted) return;
        setInboxes(Array.isArray(data.inboxes) ? data.inboxes : []);
        setConfigured(data.configured !== false);
        setLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("error");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const checkForMail = useCallback(
    async (inboxId: string, silent = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!silent) setChecking(true);
      try {
        const response = await fetch("/api/inbox/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ inboxId }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          // A background check that is throttled is not worth interrupting for;
          // the next one will come round on its own.
          if (!silent) setError(data?.error ?? "Could not read that inbox.");
          return;
        }
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setCode(typeof data.code === "string" ? data.code : null);
        setLastChecked(new Date());
        setError(null);
      } catch {
        if (!silent) setError("Could not reach the inbox. Try again.");
      } finally {
        inFlight.current = false;
        if (!silent) setChecking(false);
      }
    },
    [],
  );

  // Check as soon as an inbox becomes active, then on the interval while the tab
  // is actually on screen.
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void checkForMail(active.id, true);
    };
    // The first check is deferred rather than called here, so the effect body
    // only ever subscribes to a timer and never updates state itself.
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active, checkForMail]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data?.error ?? "Could not create an inbox.");
        return;
      }
      setMessages([]);
      setCode(null);
      setLastChecked(null);
      setInboxes((current) => [data.inbox as InboxView, ...current]);
    } catch {
      setError("Could not create an inbox. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDiscard() {
    if (!active) return;
    setDiscarding(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox/discard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ inboxId: active.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data?.error ?? "Could not discard that inbox.");
        return;
      }
      // Applied from the response rather than by re-fetching, so discarding does
      // not blank the page into a loading state to confirm what just happened.
      setInboxes((current) =>
        current.map((inbox) => (inbox.id === active.id ? (data.inbox as InboxView) : inbox)),
      );
      setMessages([]);
      setCode(null);
      setLastChecked(null);
    } catch {
      setError("Could not discard that inbox. Try again.");
    } finally {
      setDiscarding(false);
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the address and copy it manually.");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-line bg-white py-16 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (loadState === "error") {
    // EmptyState's action is a Link, so a retry that re-runs the fetch has to be
    // a button beside it rather than the action prop.
    return (
      <div className="space-y-3">
        <EmptyState
          icon={AlertCircle}
          title="Could not load your inbox"
          body="Something went wrong reading your inboxes. Try again, and contact support if it keeps happening."
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={reload}
            className="btn border border-line bg-white !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.78rem] text-ink hover:border-lav-200"
          >
            <Refresh className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <EmptyState
        icon={Mail}
        title="Temporary inboxes are not switched on yet"
        body="This is free and will let you create one inbox at a time, read what arrives in it and discard it. It is not available in this environment yet."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-white p-5">
        {!active ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-[1rem] font-medium text-ink">Create a free inbox</h2>
              <p className="mt-1 text-[0.84rem] leading-relaxed text-ink-2">
                One free inbox per day. It stays alive until you discard it, and nothing is kept
                afterwards — read your code while it is open. If you need several at once or want
                messages retained, that is what the paid inbox is for.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="btn btn-primary !py-2.5 !text-[0.84rem] disabled:opacity-50"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Create free inbox
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-meta uppercase tracking-wide text-ink-3">Your inbox</p>
                <p className="mt-1 font-mono text-[0.95rem] text-ink sm:text-[1.05rem]">{active.address}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyAddress(active.address)}
                  className="btn border border-line bg-white !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.84rem] text-ink hover:border-lav-200"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => void checkForMail(active.id)}
                  disabled={checking}
                  className="btn border border-line bg-white !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.78rem] text-ink hover:border-lav-200 disabled:opacity-50"
                >
                  {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Refresh className="h-3.5 w-3.5" />}
                  Check for mail
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-3">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {lastChecked
                  ? `Checked at ${lastChecked.toLocaleTimeString()}`
                  : "Checking for mail every 15 seconds"}
              </span>
              {active.expiresAt && <span>Expires {new Date(active.expiresAt).toLocaleString()}</span>}
            </div>

            {code && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-meta uppercase tracking-wide text-emerald-700">Verification code</p>
                <p className="mt-1 font-mono text-[1.5rem] font-semibold tracking-widest text-emerald-900">{code}</p>
              </div>
            )}

            {messages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[0.8rem] text-ink-3">
                Nothing has arrived yet. Send something to the address above and it will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {messages.map((message, index) => {
                  const key = `${message.receivedAt ?? ""}-${message.subject ?? ""}-${index}`;
                  const isOpen = opened === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setOpened(isOpen ? null : key)}
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-lav-50/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[0.84rem] font-medium text-ink">
                            {message.subject ?? "(no subject)"}
                          </span>
                          <span className="mt-0.5 block truncate text-meta text-ink-3">
                            {message.from ?? "unknown sender"}
                            {message.code ? ` · code ${message.code}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-meta text-ink-3">
                          {message.receivedAt ? new Date(message.receivedAt).toLocaleTimeString() : ""}
                        </span>
                      </button>
                      {isOpen && message.body && (
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 pb-4 text-meta leading-relaxed text-ink-2">
                          {message.body}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-line pt-4">
              <button
                type="button"
                onClick={() => void handleDiscard()}
                disabled={discarding}
                className="btn border border-rose-200 bg-white !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.78rem] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Discard inbox
              </button>
              <p className="mt-2 text-meta leading-relaxed text-ink-3">
                Discarding ends this inbox immediately and anything still in it is lost. It does not
                give you another free one today.
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.8rem] leading-relaxed text-rose-700"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {inboxes.filter((inbox) => inbox.status !== "active").length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[0.95rem] font-medium text-ink">Previous inboxes</h2>
          <ul className="mt-3 divide-y divide-line">
            {inboxes
              .filter((inbox) => inbox.status !== "active")
              .slice(0, 10)
              .map((inbox) => (
                <li key={inbox.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-mono text-[0.8rem] text-ink-2">{inbox.address}</span>
                  <span className="text-meta text-ink-3">
                    {inbox.status} · {new Date(inbox.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-meta leading-relaxed text-ink-3">
            A free inbox keeps nothing once it ends, so these addresses are a record that you used
            one — not a place to read old mail.
          </p>
        </div>
      )}
    </div>
  );
}
