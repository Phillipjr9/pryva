"use client";

import { useState } from "react";
import { DigitalCatalogBrowser } from "../digital-catalog/DigitalCatalogBrowser";

const regions = [
  { label: "United States", slug: "united-states" },
  { label: "Canada", slug: "canada" },
  { label: "India", slug: "india" },
  { label: "Kazakhstan", slug: "kazakhstan" },
  { label: "Saudi Arabia", slug: "saudi-arabia" },
];

export function CallOfDutyBrowser() {
  const [region, setRegion] = useState(regions[0].slug);
  const category = `topups-call-of-duty-mobile-activision-${region}`;
  return <div className="space-y-4">
    <div className="rounded-[1.5rem] border border-lav-200/80 bg-[#f6f1fc] p-4 sm:p-6"><label htmlFor="cod-region" className="block text-meta font-semibold text-ink">Activision account region</label>
      <select id="cod-region" value={region} onChange={(event) => setRegion(event.target.value)} className="mt-2 min-h-11 w-full max-w-md rounded-xl border border-line bg-white px-3 py-2">
        {regions.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
      </select>
    </div>
    <DigitalCatalogBrowser key={category} fixedCategory={category} />
  </div>;
}
