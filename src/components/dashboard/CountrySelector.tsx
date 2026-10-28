"use client";

import { CountryFlag } from "@/components/CountryFlag";
import { EXPLORER_COUNTRIES } from "@/lib/explorer-countries";
import { explorerCountry } from "@/lib/service-explorer";

const QUICK_COUNTRIES = ["ng", "us", "gb", "ca", "gh"];

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  name?: string;
};

export function CountrySelector({ id, value, onChange, name }: Props) {
  const selected = explorerCountry(value);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[0.72rem] font-semibold text-ink-2">
        Country of service
      </label>
      <div className="relative flex items-center rounded-xl border border-line bg-white transition-colors focus-within:border-lav-500 focus-within:ring-4 focus-within:ring-lav-100">
        <span className="pointer-events-none absolute left-3.5">
          <CountryFlag code={selected?.code} region={selected?.name ?? "Choose a country"} size={24} decorative />
        </span>
        <select
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          className="min-h-12 w-full appearance-none rounded-xl bg-transparent py-3 pl-12 pr-10 text-[0.85rem] font-medium text-ink outline-none"
        >
          <option value="">Select a country</option>
          {EXPLORER_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}{country.dial ? ` (${country.dial})` : ""}</option>)}
        </select>
        <span className="pointer-events-none absolute right-4 text-ink-3" aria-hidden="true">⌄</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Quick country choices">
        <span className="mr-1 text-[0.67rem] text-ink-3">Quick select:</span>
        {QUICK_COUNTRIES.map((code) => {
          const country = explorerCountry(code)!;
          const active = value === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(code)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.67rem] font-semibold transition-colors ${active ? "border-lav-400 bg-lav-100 text-lav-800" : "border-line bg-white/75 text-ink-2 hover:border-lav-300"}`}
            >
              <CountryFlag code={country.code} size={15} decorative radius={8} />
              {country.name === "United States" ? "US" : country.name === "United Kingdom" ? "UK" : country.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
