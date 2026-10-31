"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Loader2,
  Mail,
  Plus,
  Refresh,
  Trash2,
} from "@/components/icons";
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
 */
const POLL_INTERVAL_MS = 15_000;

export function InboxManager() {
  const [inboxes, setInboxes] = useState<InboxView[]>([]);
  const [configured, setConfigured] = useState(true);
  const [disabledReason, setDisabledReason] = useState<"preview" | "not_configured" | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const active = inboxes.find((inbox) => inbox.status === "active") ?? null;
  const savedInboxes = inboxes.filter((inbox) => inbox.status !== "discarded");

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
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
        setDisabledReason(
          data.reason === "preview" || data.reason === "not_configured" ? data.reason : null,
        );
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

  // Check as soon as an inbox becomes active, then on interval
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void checkForMail(active.id, true);
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active?.id, checkForMail]);

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

      const newInbox = data.inbox as InboxView;
      setInboxes((current) => [
        newInbox,
        ...current.map((ib) => (ib.status === "active" ? { ...ib, status: "saved" } : ib)),
      ]);
      void checkForMail(newInbox.id);
    } catch {
      setError("Could not create an inbox. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSelect(inboxId: string) {
    setSelectingId(inboxId);
    setError(null);
    try {
      const response = await fetch("/api/inbox/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ inboxId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data?.error ?? "Could not switch to that inbox.");
        return;
      }
      const activated = data.inbox as InboxView;
      setInboxes((current) =>
        current.map((ib) =>
          ib.id === inboxId
            ? activated
            : ib.status === "active"
              ? { ...ib, status: "saved" }
              : ib,
        ),
      );
      setMessages([]);
      setCode(null);
      setLastChecked(null);
      void checkForMail(inboxId);
    } catch {
      setError("Could not switch inboxes. Try again.");
    } finally {
      setSelectingId(null);
    }
  }

  async function handleDiscard(inboxId: string) {
    setDiscardingId(inboxId);
    setError(null);
    try {
      const response = await fetch("/api/inbox/discard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ inboxId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data?.error ?? "Could not discard that inbox.");
        return;
      }
      setInboxes((current) =>
        current.map((ib) => (ib.id === inboxId ? (data.inbox as InboxView) : ib)),
      );

      // If we discarded the active one, auto-switch to the next saved inbox
      if (active?.id === inboxId) {
        const nextSaved = inboxes.find((ib) => ib.id !== inboxId && ib.status !== "discarded");
        if (nextSaved) {
          void handleSelect(nextSaved.id);
        } else {
          setMessages([]);
          setCode(null);
          setLastChecked(null);
        }
      }
    } catch {
      setError("Could not discard that inbox. Try again.");
    } finally {
      setDiscardingId(null);
    }
  }

  async function copyAddress(address: string, id: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
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
        title={
          disabledReason === "preview"
            ? "Temporary inboxes are not available on this deployment"
            : "Temporary inboxes are not switched on yet"
        }
        body={
          disabledReason === "preview"
            ? "This is the preview environment, which has no mailbox provider behind it. The feature works on production."
            : "The mailbox provider is not configured on this server, so there is nothing to create an inbox from."
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Active Mailbox Card */}
      <div className="rounded-2xl border border-line bg-white p-5">
        {!active ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-[1.05rem] font-medium text-ink">Create a disposable email</h2>
              <p className="mt-1 text-[0.84rem] leading-relaxed text-ink-2">
                Generate instant temporary email addresses to receive emails and verification codes.
                All your emails and received messages are saved so you can reuse them anytime.
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
                <div className="flex items-center gap-2">
                  <p className="text-meta uppercase tracking-wide text-ink-3">Active inbox</p>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.68rem] font-medium text-emerald-700">
                    Live
                  </span>
                </div>
                <p className="mt-1 font-mono text-[1rem] font-medium text-ink sm:text-[1.15rem]">
                  {active.address}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyAddress(active.address, active.id)}
                  className="btn border border-line bg-white !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.84rem] text-ink hover:border-lav-200"
                >
                  {copiedId === active.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === active.id ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => void checkForMail(active.id)}
                  disabled={checking}
                  className="btn border border-line bg-white !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.84rem] text-ink hover:border-lav-200 disabled:opacity-50"
                >
                  {checking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Refresh className="h-3.5 w-3.5" />
                  )}
                  Check mail
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="btn btn-primary !px-3.5 !py-2 !text-[0.8125rem] sm:!text-[0.84rem] disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  New email
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-3">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {lastChecked
                  ? `Checked at ${lastChecked.toLocaleTimeString()}`
                  : "Auto-refreshing every 15 seconds"}
              </span>
              {active.expiresAt && (
                <span>Expires {new Date(active.expiresAt).toLocaleString()}</span>
              )}
            </div>

            {/* OTP Banner */}
            {code && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-meta uppercase tracking-wide text-emerald-700">
                  Verification code
                </p>
                <p className="mt-1 font-mono text-[1.5rem] font-semibold tracking-widest text-emerald-900">
                  {code}
                </p>
              </div>
            )}

            {/* Messages List */}
            {messages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[0.8rem] text-ink-3">
                Nothing has arrived yet. Send an email to the address above and it will appear here
                automatically.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-meta font-medium uppercase tracking-wide text-ink-3">
                  Received messages ({messages.length})
                </p>
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
                            {message.receivedAt
                              ? new Date(message.receivedAt).toLocaleTimeString()
                              : ""}
                          </span>
                        </button>
                        {isOpen && message.body && (
                          <EmailContentViewer body={message.body} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="border-t border-line pt-3">
              <button
                type="button"
                onClick={() => void handleDiscard(active.id)}
                disabled={discardingId === active.id}
                className="btn border border-rose-200 bg-white !px-3 !py-1.5 !text-[0.78rem] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {discardingId === active.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Discard this email
              </button>
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

      {/* Saved / Previous Inboxes List */}
      {savedInboxes.length > 0 && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[0.95rem] font-medium text-ink">Saved inboxes</h2>
              <p className="mt-0.5 text-meta text-ink-3">
                Your email addresses are saved here. Click &ldquo;Use this inbox&rdquo; to switch back
                to any saved email.
              </p>
            </div>
            {!active && (
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="btn btn-primary !px-3.5 !py-2 !text-[0.8125rem]"
              >
                <Plus className="h-3.5 w-3.5" /> Create new email
              </button>
            )}
          </div>

          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {savedInboxes.map((inbox) => {
              const isActive = inbox.id === active?.id;
              const isSelecting = selectingId === inbox.id;
              const isDiscarding = discardingId === inbox.id;

              return (
                <li
                  key={inbox.id}
                  className={`flex flex-wrap items-center justify-between gap-3 p-3.5 ${
                    isActive ? "bg-lav-50/20" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.88rem] font-medium text-ink">
                        {inbox.address}
                      </span>
                      {isActive && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-800">
                          Active
                        </span>
                      )}
                    </div>
                    <span className="mt-0.5 block text-meta text-ink-3">
                      Created {new Date(inbox.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyAddress(inbox.address, inbox.id)}
                      className="btn border border-line bg-white !p-2 text-ink hover:border-lav-200"
                      title="Copy address"
                    >
                      {copiedId === inbox.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>

                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => void handleSelect(inbox.id)}
                        disabled={isSelecting}
                        className="btn border border-line bg-white !px-3 !py-1.5 !text-[0.78rem] text-ink hover:border-lav-200 disabled:opacity-50"
                      >
                        {isSelecting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ArrowRight className="h-3 w-3" />
                        )}
                        Use this inbox
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleDiscard(inbox.id)}
                      disabled={isDiscarding}
                      className="btn border border-line bg-white !p-2 text-rose-600 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                      title="Delete inbox"
                    >
                      {isDiscarding ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmailContentViewer({ body }: { body: string }) {
  const [viewMode, setViewMode] = useState<"html" | "text">("html");
  const [iframeHeight, setIframeHeight] = useState(380);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isHtml = /<\/?[a-z][\s\S]*>/i.test(body);

  const preparedHtml = isHtml
    ? body.includes("<head>")
      ? body.replace("<head>", '<head><base target="_blank">')
      : `<!DOCTYPE html><html><head><base target="_blank"><style>body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;}</style></head><body>${body}</body></html>`
    : "";

  const handleIframeLoad = () => {
    try {
      if (iframeRef.current?.contentWindow?.document?.body) {
        const scrollH = iframeRef.current.contentWindow.document.body.scrollHeight;
        if (scrollH > 100) {
          setIframeHeight(Math.max(250, Math.min(scrollH + 30, 800)));
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCopy = async () => {
    try {
      const textToCopy = isHtml
        ? body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
        : body;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="border-t border-line/60 bg-slate-50/50 p-4">
      {isHtml && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line/40 pb-2.5">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-0.5 text-[0.75rem]">
            <button
              type="button"
              onClick={() => setViewMode("html")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                viewMode === "html" ? "bg-lav-100 text-ink shadow-xs" : "text-ink-3 hover:text-ink"
              }`}
            >
              Rich Template
            </button>
            <button
              type="button"
              onClick={() => setViewMode("text")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                viewMode === "text" ? "bg-lav-100 text-ink shadow-xs" : "text-ink-3 hover:text-ink"
              }`}
            >
              Plain Text
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="btn border border-line bg-white !px-2.5 !py-1 !text-[0.75rem] text-ink hover:border-lav-200"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy text"}
          </button>
        </div>
      )}

      {isHtml && viewMode === "html" ? (
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-xs">
          <iframe
            ref={iframeRef}
            srcDoc={preparedHtml}
            sandbox="allow-same-origin allow-popups"
            onLoad={handleIframeLoad}
            style={{ height: `${iframeHeight}px` }}
            className="w-full border-0 transition-[height]"
            title="Email template design"
          />
        </div>
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-4 font-mono text-[0.8rem] leading-relaxed text-ink-2">
          {isHtml
            ? body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
            : body}
        </pre>
      )}
    </div>
  );
}
