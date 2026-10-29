"use client";

import { useState } from "react";

/**
 * Marketplace credentials are shown once at purchase and then kept here.
 * Each line gets its own copy button; nothing is fetched on the client, the
 * values are handed down from the server component.
 */
export function CredentialList({ accounts }: { accounts: string[] }) {
  const [copied, setCopied] = useState<number | "all" | null>(null);

  async function copy(value: string, key: number | "all") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard blocked (insecure context) — the text stays selectable.
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="text-[0.85rem] text-ink-2">
        No credentials were returned for this order. Contact support with your reference and we&apos;ll
        fix it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {accounts.map((account, index) => (
        <div key={`${index}-${account.slice(0, 8)}`} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-white px-3 py-2 font-mono text-[0.78rem] text-ink">
            {account}
          </code>
          <button
            type="button"
            onClick={() => void copy(account, index)}
            className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.72rem] font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-ink"
          >
            {copied === index ? "Copied" : "Copy"}
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => void copy(accounts.join("\n"), "all")}
        className="mt-1 rounded-lg border border-line bg-white px-3 py-1.5 text-[0.74rem] font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-ink"
      >
        {copied === "all" ? "All copied" : "Copy all"}
      </button>

      <p className="pt-1 text-[0.72rem] text-ink-3">
        Treat these like passwords. Each line is one account, exactly as described.
      </p>
    </div>
  );
}
