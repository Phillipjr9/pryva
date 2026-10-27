import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { BrandLockup } from "@/components/brand/BrandLockup";

export default function NotFound() {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-cream px-5">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[30rem] w-[40rem] -translate-x-1/2 rounded-full bg-lav-200/40 blur-[120px]" />
      <div className="relative w-full max-w-lg text-center">
        <div className="mb-6 flex justify-center">
          <BrandLockup size="md" />
        </div>
        <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-[#fffdfa] px-6 py-10 shadow-[var(--shadow-card)]">
          <p className="eyebrow justify-center">404 · Page not found</p>
          <h1 className="mt-3 text-[2rem] font-medium leading-[1.1]">
            This page took
            <br />
            <span className="text-display italic text-lav-700">a different route.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-[0.9rem] leading-relaxed text-ink-2">
            The link may be old, or the page moved. Your wallet and orders are safe in the dashboard.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
            <Link href="/" className="btn btn-primary">
              Back home
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/dashboard" className="btn btn-ghost">
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
