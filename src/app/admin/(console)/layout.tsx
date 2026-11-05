import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/identity/auth";
import { OperatorNav, OperatorSignOut } from "./OperatorNav";

/**
 * The operator console shell.
 *
 * Deliberately not the storefront: no cart, no wallet, no services menu, no
 * customer nav. An operator signing in here is working, and a page that offers to
 * sell them an eSIM while they read a refund queue is a page that has not decided
 * who it is for. The single link back to the customer account is labelled as such,
 * so leaving is a choice rather than an escape hatch.
 *
 * `requireAdmin` is the control. It redirects a signed-out visitor to `/login` and
 * a signed-in customer to `/dashboard` — the shell is a consequence of that check,
 * never a substitute for it.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const operator = await requireAdmin();

  return (
    <div className="min-h-screen bg-cream lg:flex">
      <OperatorNav email={operator.email} />

      <div className="min-w-0 flex-1">
        {/* A quiet top strip: who you are signed in as, and the way out. */}
        <div className="hidden items-center justify-between gap-4 border-b border-line bg-white px-6 py-2.5 lg:flex">
          <p className="text-meta text-ink-3">
            Signed in as <span className="font-medium text-ink-2">{operator.email}</span>
          </p>
          <OperatorSignOut />
        </div>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>

        <div className="border-t border-line px-4 py-3 lg:hidden">
          <OperatorSignOut variant="inline" />
        </div>
      </div>
    </div>
  );
}
