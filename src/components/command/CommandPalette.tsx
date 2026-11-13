"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/components/icons";
import { formatNaira } from "@/lib/services/catalog";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Manage" | "Orders" | "Gift cards" | "Wallet activity";
  href: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMANDS: Command[] = [
  { id: "dashboard", label: "Dashboard overview", group: "Navigate", href: "/dashboard" },
  { id: "services", label: "Explore services", group: "Navigate", href: "/dashboard/services" },
  { id: "orders", label: "Orders", group: "Navigate", href: "/dashboard/orders" },
  { id: "wallet", label: "Wallet", group: "Navigate", href: "/dashboard/wallet" },
  { id: "accounts", label: "Digital accounts", group: "Navigate", href: "/dashboard/accounts" },
  { id: "digital", label: "Subscriptions", group: "Navigate", href: "/dashboard/services?category=subscriptions" },
  { id: "data", label: "Data plans", group: "Navigate", href: "/dashboard/data" },
  { id: "gift-cards", label: "Gift cards", group: "Navigate", href: "/dashboard/services?category=gift-cards" },
  { id: "pryva-gift-cards", label: "Pryva gift cards", group: "Manage", href: "/dashboard/gift-cards" },
  { id: "bulk", label: "Bulk orders", group: "Navigate", href: "/dashboard/bulk-orders" },
  { id: "scheduled", label: "Scheduled orders", group: "Navigate", href: "/dashboard/scheduled" },
  { id: "notifications", label: "Notifications", group: "Manage", href: "/dashboard/notifications" },
  { id: "security", label: "Security settings", group: "Manage", href: "/dashboard/settings#security" },
  { id: "settings", label: "Settings", group: "Manage", href: "/dashboard/settings" },
  { id: "support", label: "Support", group: "Manage", href: "/dashboard/support" },
  { id: "home", label: "Marketing site", group: "Manage", href: "/" },
];

type Row = {
  id: string;
  label: string;
  hint: string;
  group: Command["group"];
  href: string;
};

/**
 * Dashboard command palette (⌘K / Ctrl+K).
 *
 * It used to hold eight hard-coded navigation entries while `/api/search` —
 * which searches this user's orders, wallet transactions and gift cards — had no
 * caller at all. Typing an order reference did nothing. Results now come from
 * that endpoint, with arrow-key navigation and a click-outside close.
 */
export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const requestId = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();

    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const commands = COMMANDS.filter((command) => !needle || command.label.toLowerCase().includes(needle));
    return [...commands.map((command) => ({ ...command, hint: command.hint ?? "" })), ...rows];
  }, [search, rows]);

  // The highlighted row is derived, never synced in an effect: a shorter result
  // list simply clamps the index during render.
  const activeIndex = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  // Grouped for display, but positions come from the flat `matches` order so
  // arrow keys and click targets always agree.
  const grouped = useMemo(() => {
    const buckets: Array<{ group: string; entries: Array<{ entry: (typeof matches)[number]; position: number }> }> = [];
    matches.forEach((entry, position) => {
      const bucket = buckets.find((item) => item.group === entry.group);
      if (bucket) bucket.entries.push({ entry, position });
      else buckets.push({ group: entry.group, entries: [{ entry, position }] });
    });
    return buckets;
  }, [matches]);

  // The shell only mounts this component while the palette is open, so state
  // starts empty every time — no reset effect (and no cascading render).
  const runSearch = useCallback(async (query: string) => {
    const current = ++requestId.current;
    const needle = query.trim();
    if (needle.length < 2) {
      setRows([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(needle)}&type=all`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        results?: {
          orders?: Array<{ id: string; reference: string; productName: string; amount: number; status: string }>;
          transactions?: Array<{ id: string; type: string; amount: number; description: string; reference: string }>;
          giftCards?: Array<{ id: string; code: string; amount: number; status: string }>;
        };
      };
      if (current !== requestId.current) return;
      if (!response.ok || !data.ok || !data.results) {
        setFailed(true);
        setRows([]);
        return;
      }
      const next: Row[] = [
        ...(data.results.orders ?? []).map((order) => ({
          id: `order-${order.id}`,
          label: order.productName,
          hint: `${order.reference} · ${formatNaira(order.amount)} · ${order.status}`,
          group: "Orders" as const,
          href: `/dashboard/orders/${order.id}`,
        })),
        ...(data.results.giftCards ?? []).map((card) => ({
          id: `gift-${card.id}`,
          label: `Gift card ${card.code.slice(0, 4)}…`,
          hint: `${formatNaira(card.amount)} · ${card.status}`,
          group: "Gift cards" as const,
          href: "/dashboard/gift-cards",
        })),
        ...(data.results.transactions ?? []).map((transaction) => ({
          id: `tx-${transaction.id}`,
          label: transaction.description,
          hint: `${transaction.type} · ${formatNaira(transaction.amount)} · ${transaction.reference}`,
          group: "Wallet activity" as const,
          href: "/dashboard/wallet",
        })),
      ];
      setRows(next);
      setFailed(false);
    } catch {
      if (current === requestId.current) {
        setFailed(true);
        setRows([]);
      }
    } finally {
      if (current === requestId.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void runSearch(search), 280);
    return () => clearTimeout(timer);
  }, [isOpen, search, runSearch]);

  function go(entry: { href: string }) {
    onClose();
    router.push(entry.href);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (matches.length === 0) return;
        setActive((index) => {
          const current = Math.min(index, matches.length - 1);
          return event.key === "ArrowDown"
            ? (current + 1) % matches.length
            : (current - 1 + matches.length) % matches.length;
        });
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : Math.max(0, matches.length - 1));
        return;
      }
      if (event.key === "Enter" && event.target === searchRef.current) {
        event.preventDefault();
        const entry = matches[Math.min(active, Math.max(0, matches.length - 1))];
        if (entry) go(entry);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose, matches, active]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[16dvh] backdrop-blur-sm sm:pt-[20dvh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard search and commands"
        tabIndex={-1}
        className="flex max-h-[calc(84dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-float)] sm:max-h-[calc(80dvh-1rem)]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            placeholder="Search orders, transactions, gift cards or jump to a page…"
            aria-label="Search the dashboard"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dashboard search"
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-line px-3 text-meta font-semibold text-ink-2 hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lav-500"
          >
            Close
          </button>
        </div>

        <div ref={listRef} className="min-h-0 max-h-[26rem] flex-1 overflow-y-auto overscroll-contain p-2" role="listbox" aria-label="Results">
          {searching && (
            <p className="px-4 py-3 text-[0.8125rem] text-ink-3" role="status">
              Searching your orders and wallet…
            </p>
          )}
          {!searching && failed && (
            <p className="px-4 py-3 text-[0.8125rem] text-rose-700" role="alert">
              Search is unavailable right now. Navigation below still works.
            </p>
          )}
          {!searching && !failed && matches.length === 0 && (
            <p className="px-4 py-8 text-center text-[0.875rem] text-ink-2">
              Nothing matches “{search.trim()}”. Try an order reference, a product name or a page.
            </p>
          )}

          {grouped.map(({ group, entries }) => (
            <div key={group} className="mb-1">
              <p className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.16em] text-ink-3">
                {group}
              </p>
              {entries.map(({ entry, position }) => {
                const isActive = position === activeIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-index={position}
                    onMouseMove={() => setActive(position)}
                    onClick={() => go(entry)}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors ${
                      isActive ? "bg-lav-50" : "hover:bg-cream"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] font-medium text-ink">{entry.label}</span>
                      {entry.hint && (
                        <span className="block truncate text-meta text-ink-3">{entry.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="shrink-0 border-t border-line px-4 py-2 text-micro text-ink-3">
          Use arrow keys to move, Enter to open and Escape to close.
        </p>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onClick();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClick]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search the dashboard"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/70 text-meta font-semibold text-ink-2 transition-colors hover:bg-white lg:h-auto lg:min-h-9 lg:w-auto lg:px-3 lg:py-2"
    >
      <Search className="h-5 w-5 lg:hidden" aria-hidden="true" />
      <span className="hidden lg:inline">Search</span>
    </button>
  );
}
