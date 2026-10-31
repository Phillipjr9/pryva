import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "You're offline",
  description: "Pryva could not reach the network. Your balance and orders are unaffected.",
  robots: { index: false, follow: false },
};

/**
 * The only page the service worker ever serves from cache. It holds no account
 * data on purpose: a cached "offline" fallback is shared by every profile on the
 * device, so it must be safe for a stranger to see.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-5 py-16">
      <span className="eyebrow w-fit">Offline</span>
      <h1 className="mt-3 text-[2rem] font-medium leading-[1.1] tracking-[-0.03em]">
        The connection dropped.
      </h1>
      <p className="mt-3 text-[0.92rem] leading-relaxed text-ink-2">
        Nothing was lost. Your wallet balance, orders and sign-in are only ever read from the
        server, so this page deliberately shows none of them. Reconnect and the app will pick up
        where you left off.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/" className="btn btn-primary">
          Try again
        </Link>
        <Link href="/help" className="btn btn-ghost">
          Help
        </Link>
      </div>
    </main>
  );
}
