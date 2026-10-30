"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/catalog";
import {
  BarChart3,
  Bell,
  Calendar,
  Chat,
  Gift,
  Grid,
  Home,
  Receipt,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Sparkle,
  Wallet,
} from "@/components/icons";

type Icon = React.ComponentType<{ className?: string }>;

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: Icon;
  group: "Navigate" | "Manage" | "Orders" | "Gift cards" | "Wallet activity";
  href: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMANDS: Command[] = [
  { id: "dashboard", label: "Dashboard overview", icon: BarChart3, group: "Navigate", href: "/dashboard" },
  { id: "services", label: "Explore services", icon: Sparkle, group: "Navigate", href: "/dashboard/services" },
  { id: "orders", label: "Orders", icon: Receipt, group: "Navigate", href: "/dashboard/orders" },
  { id: "wallet", label: "Wallet", icon: Wallet, group: "Navigate", href: "/dashboard/wallet" },
  { id: "accounts", label: "Digital accounts", icon: ShoppingCart, group: "Navigate", href: "/dashboard/accounts" },
  { id: "digital", label: "Subscriptions", icon: Grid, group: "Navigate", href: "/dashboard/digital" },
  { id: "data", label: "Data plans", icon: Grid, group: "Navigate", href: "/dashboard/data" },
  { id: "gift-cards", label: "Gift cards", icon: Gift, group: "Navigate", href: "/dashboard/gift-cards" },
  { id: "bulk", label: "Bulk orders", icon: ShoppingCart, group: "Navigate", href: "/dashboard/bulk-orders" },
  { id: "scheduled", label: "Scheduled orders", icon: Calendar, group: "Navigate", href: "/dashboard/scheduled" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "Manage", href: "/dashboard/notifications" },
  { id: "security", label: "Security settings", icon: Shield, group: "Manage", href: "/dashboard/settings#security" },
  { id: "settings", label: "Settings", icon: Settings, group: "Manage", href: "/dashboard/settings" },
  { id: "support", label: "Support", icon: Chat, group: "Manage", href: "/dashboard/support" },
  { id: "home", label: "Marketing site", icon: Home, group: "Manage", href: "/" },
];

type Row = {
  id: string;
  label: string;
  hint: string;
  group: Command["group"];
  icon: Icon;
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
          icon: Receipt,
          href: `/dashboard/orders/${order.id}`,
        })),
        ...(data.results.giftCards ?? []).map((card) => ({
          id: `gift-${card.id}`,
          label: `Gift card ${card.code.slice(0, 4)}…`,
          hint: `${formatNaira(card.amount)} · ${card.status}`,
          group: "Gift cards" as const,
          icon: Gift,
          href: "/dashboard/gift-cards",
        })),
        ...(data.results.transactions ?? []).map((transaction) => ({
          id: `tx-${transaction.id}`,
          label: transaction.description,
          hint: `${transaction.type} · ${formatNaira(transaction.amount)} · ${transaction.reference}`,
          group: "Wallet activity" as const,
          icon: Wallet,
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
      if (event.key === "Enter") {
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
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[16vh] backdrop-blur-sm sm:pt-[20vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard search and commands"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-float)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-ink-2" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            placeholder="Search orders, transactions, gift cards or jump to a page…"
            aria-label="Search the dashboard"
            className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-ink outline-none placeholder:text-ink-3"
            autoFocus
          />
          <kbd className="hidden rounded border border-line bg-cream px-2 py-0.5 text-meta font-medium text-ink-2 sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(26rem,60vh)] overflow-y-auto p-2" role="listbox" aria-label="Results">
          {searching && (
            <p className="px-4 py-3 text-[0.84rem] text-ink-3" role="status">
              Searching your orders and wallet…
            </p>
          )}
          {!searching && failed && (
            <p className="px-4 py-3 text-[0.84rem] text-rose-700" role="alert">
              Search is unavailable right now. Navigation below still works.
            </p>
          )}
          {!searching && !failed && matches.length === 0 && (
            <p className="px-4 py-8 text-center text-[0.9rem] text-ink-2">
              Nothing matches “{search.trim()}”. Try an order reference, a product name or a page.
            </p>
          )}

          {grouped.map(({ group, entries }) => (
            <div key={group} className="mb-1">
              <p className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.16em] text-ink-3">
                {group}
              </p>
              {entries.map(({ entry, position }) => {
                const Icon = entry.icon;
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
                    <Icon className="h-4 w-4 shrink-0 text-ink-2" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-medium text-ink">{entry.label}</span>
                      {entry.hint && (
                        <span className="block truncate text-meta text-ink-3">{entry.hint}</span>
                      )}
                    </span>
                    {isActive && (
                      <span className="shrink-0 text-micro font-semibold text-ink-3">↵</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="border-t border-line px-4 py-2 text-micro text-ink-3">
          ↑↓ to move · ↵ to open · esc to close
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
    <>
      {/* Icon-only below lg: the full pill never fitted next to the balance and
          notifications, which left phones and tablets with no way to search. */}
      <button
        type="button"
        onClick={onClick}
        aria-label="Search the dashboard"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white/70 text-ink-2 transition-colors hover:bg-white lg:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClick}
        className="hidden items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-2 text-[0.82rem] font-medium text-ink-2 transition-colors hover:bg-white lg:flex"
      >
        <Search className="h-4 w-4" />
        <span>Search…</span>
        <kbd className="rounded border border-line bg-cream px-1.5 py-0.5 text-micro font-semibold text-ink-3">
          ⌘K
        </kbd>
      </button>
    </>
  );
}
