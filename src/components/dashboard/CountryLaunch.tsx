"use client";

import { useState } from "react";
import { ArrowRight, Globe, Sparkle } from "@/components/icons";
import { CountrySelector } from "@/components/dashboard/CountrySelector";

/** The overview starts the same country-first flow as the full service hub. */
export function CountryLaunch() {
  const [country, setCountry] = useState("");
  return (
    <section aria-labelledby="country-launch-title" className="relative overflow-hidden rounded-[1.5rem] border border-lav-200/80 bg-[#f6f1fc] p-4 sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-lav-300/30 blur-3xl" />
      <div className="relative grid gap-3 md:grid-cols-[1fr_1.05fr] md:items-center md:gap-5">
        <div>
          <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700">
            <Sparkle className="h-3.5 w-3.5" /> Your service hub
          </p>
          <h2 id="country-launch-title" className="mt-1.5 text-[1.2rem] font-semibold leading-tight text-ink sm:mt-2 sm:text-[1.6rem]">
            Find what you need, <span className="text-display italic text-lav-700">where you need it.</span>
          </h2>
          <p className="mt-1.5 max-w-md text-meta leading-relaxed text-ink-2 sm:mt-2">
            Pick a country first, then explore verification, social media and all our service categories.
          </p>
        </div>
        <form action="/dashboard/services" method="get" className="rounded-2xl border border-white/80 bg-white/60 p-3 shadow-sm sm:p-4">
          <input type="hidden" name="country" value={country || "ng"} />
          <CountrySelector id="dashboard-country" value={country} onChange={setCountry} />
          <button type="submit" className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-meta font-semibold text-white transition-colors hover:bg-lav-800 sm:mt-4 sm:py-3 sm:text-[0.85rem]">
            <Globe className="h-4 w-4" /> {country ? "Explore services for selected country" : "Explore all services (Nigeria default)"} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
