import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { isPreviewDatabase } from "@/lib/demo-policy";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[52rem] -translate-x-1/2 rounded-full bg-lav-200/35 blur-[130px]" />
        <div className="absolute right-[-10rem] top-[30rem] h-[26rem] w-[26rem] rounded-full bg-peach/40 blur-[120px]" />
      </div>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <SiteHeader />
      <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[0.8rem] text-amber-900">
        {isPreviewDatabase()
          ? "Preview mode: balances and orders are simulated. Live purchases and bank transfers are unavailable."
          : "Live number, eSIM, proxy, email, data, bulk and scheduled fulfillment is paused. Contact support about existing orders."}
      </div>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
