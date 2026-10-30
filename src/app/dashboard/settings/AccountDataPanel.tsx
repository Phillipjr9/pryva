"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "@/components/ui/Toast";
import { ArrowRight, Download, Loader2, Shield } from "@/components/icons";

/**
 * Your data.
 *
 * `/api/user/export` already produced a JSON archive of this account's activity,
 * but nothing in the product linked to it — the Settings page called itself
 * "read-only details". Self-service deletion deliberately returns 503 until
 * settlement and record retention are designed, so this panel says that plainly
 * and points at support instead of offering a button that always fails.
 */
export function AccountDataPanel() {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/user/export", { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Could not prepare that export. Please try again later.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pryva-account-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Your account data is downloading.");
    } catch {
      toast.error("Could not prepare that export. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lav-50 text-lav-700">
          <Download className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[0.95rem] font-semibold">Your data</h2>
          <p className="mt-0.5 text-meta text-ink-2">
            Download a JSON copy of your profile, orders, wallet activity, gift cards and schedules.
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="btn w-fit border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink hover:border-lav-300 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing…
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" /> Download my data
            </>
          )}
        </button>

        <p className="flex items-start gap-2 rounded-xl bg-cream/70 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
          <span>
            The file can contain redeemable gift-card codes — store it somewhere private. It covers
            selected activity, not a complete personal-data record.
          </span>
        </p>

        <p className="text-meta leading-relaxed text-ink-2">
          Closing your account permanently is not self-service yet: remaining balances, settled
          payments and record retention have to be reviewed first.{" "}
          <Link
            href="/dashboard/support"
            className="inline-flex items-center gap-1 font-semibold text-lav-700 hover:underline"
          >
            Ask support to close it <ArrowRight className="h-3 w-3" />
          </Link>
        </p>
      </div>
    </section>
  );
}
