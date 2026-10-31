import Link from "next/link";
import { ArrowRight, Home, MessageCircle } from "@/components/icons";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { NotFoundScene } from "@/components/not-found/NotFoundScene";

/**
 * The 404, with a cartoon instead of an apology.
 *
 * A wrong URL is the one page a visitor never asked for, so it gets a small
 * piece of delight rather than a red warning: an astronaut who floated off the
 * map, drawn in the site's own lavender and peach, animated in CSS (see
 * NotFoundScene). The copy still does the work — say what happened, reassure
 * that nothing was lost, and offer the two places people actually want.
 */
export default function NotFound() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-cream px-5 py-12">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[30rem] w-[40rem] -translate-x-1/2 rounded-full bg-lav-200/45 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-[22rem] w-[22rem] rounded-full bg-peach/60 blur-[110px]" />

      <div className="relative w-full max-w-xl text-center">
        <div className="mb-6 flex justify-center">
          <BrandLockup size="md" />
        </div>

        <div className="overflow-hidden rounded-[1.75rem] border border-line bg-white shadow-[var(--shadow-card)]">
          <NotFoundScene />
          <div className="border-t border-line/70 bg-[#fffdfa] px-5 py-4 sm:px-7 sm:py-5">
            <p className="eyebrow justify-center">404 · Off the map</p>
            <h1 className="mt-2 text-[1.85rem] font-medium leading-[1.12] sm:text-[2.15rem]">
              That page floated away.
              <br />
              <span className="text-display italic text-lav-700">Your account didn&rsquo;t.</span>
            </h1>
            <p className="mx-auto mt-2.5 max-w-sm text-[0.88rem] leading-relaxed text-ink-2">
              The link may be old or mistyped. Your wallet, orders and boosts are exactly where you left them.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
          <Link href="/" className="btn btn-primary">
            <Home className="h-4 w-4" />
            Back home
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/dashboard" className="btn btn-ghost">
            Go to dashboard
          </Link>
        </div>

        <p className="mt-5 text-meta leading-relaxed text-ink-3">
          Looking for something in particular?{" "}
          <Link href="/help" className="font-semibold text-lav-700 hover:underline">
            Help centre
          </Link>{" "}
          or{" "}
          <Link href="/contact" className="inline-flex items-center gap-1 font-semibold text-lav-700 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> talk to a person
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
