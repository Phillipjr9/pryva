"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Home, ShoppingCart, Wallet, Gift, Calendar, BarChart3, Settings } from "@/components/icons";

interface Command {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  category: "navigation" | "actions";
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const commands: Command[] = [
    {
      id: "home",
      label: "Go to Home",
      icon: Home,
      action: () => router.push("/"),
      category: "navigation",
    },
    {
      id: "dashboard",
      label: "Go to Dashboard",
      icon: BarChart3,
      action: () => router.push("/dashboard"),
      category: "navigation",
    },
    {
      id: "services",
      label: "Explore Services",
      icon: ShoppingCart,
      action: () => router.push("/dashboard/services"),
      category: "navigation",
    },
    {
      id: "orders",
      label: "View Orders",
      icon: ShoppingCart,
      action: () => router.push("/dashboard/orders"),
      category: "navigation",
    },
    {
      id: "wallet",
      label: "Open Wallet",
      icon: Wallet,
      action: () => router.push("/dashboard/wallet"),
      category: "navigation",
    },
    {
      id: "gift-cards",
      label: "Gift Cards",
      icon: Gift,
      action: () => router.push("/dashboard/gift-cards"),
      category: "navigation",
    },
    {
      id: "scheduled",
      label: "Scheduled Orders",
      icon: Calendar,
      action: () => router.push("/dashboard/scheduled"),
      category: "navigation",
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      action: () => router.push("/dashboard/settings"),
      category: "navigation",
    },
  ];

  const filteredCommands = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Escape") {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[20vh] backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-white shadow-[var(--shadow-float)]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-5 w-5 text-ink-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[0.95rem] text-ink outline-none placeholder:text-ink-3"
            autoFocus
          />
          <kbd className="rounded border border-line bg-cream px-2 py-0.5 text-[0.7rem] font-medium text-ink-2">
            ESC
          </kbd>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-[0.9rem] text-ink-2">
              No commands found
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCommands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    onClick={() => {
                      cmd.action();
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-cream"
                  >
                    <Icon className="h-5 w-5 text-ink-2" />
                    <span className="text-[0.9rem] font-medium text-ink">
                      {cmd.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onClick();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClick]);

  return (
    <button
      onClick={onClick}
      className="hidden items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-2 text-[0.82rem] font-medium text-ink-2 transition-colors hover:bg-white lg:flex"
    >
      <Search className="h-4 w-4" />
      <span>Search...</span>
      <kbd className="rounded border border-line bg-cream px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink-3">
        ⌘K
      </kbd>
    </button>
  );
}
