"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons";

export type FaqItem = { q: string; a: string };

export function FaqAccordion({
  items,
  defaultOpen = 0,
}: {
  items: FaqItem[];
  defaultOpen?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen);

  return (
    <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-[#fffdfa]">
      {items.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-lav-50/60 sm:px-7"
            >
              <span
                className={`text-[0.95rem] font-semibold transition-colors ${
                  isOpen ? "text-lav-700" : "text-ink"
                }`}
              >
                {item.q}
              </span>
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                  isOpen
                    ? "rotate-180 border-lav-300 bg-lav-100 text-lav-700"
                    : "border-line bg-white text-ink-3"
                }`}
              >
                <ChevronDown className="h-4 w-4" />
              </span>
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <p className="max-w-2xl px-5 pb-6 text-[0.9rem] leading-relaxed text-ink-2 sm:px-7">
                  {item.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
