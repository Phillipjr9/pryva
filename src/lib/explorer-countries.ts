import isoCountries from "../../data/iso-countries.json";
import { COUNTRIES } from "@/lib/countries";

/**
 * ISO country/territory choices are a location directory, not supplier
 * coverage. Names are from country-list 2.4.1 (MIT, see data/iso-countries.LICENSE);
 * known catalog names and dialing codes take precedence.
 */
export type ExplorerCountry = { code: string; name: string; dial?: string };
const known = new Map(COUNTRIES.map((country) => [country.code, country]));

function sortKey(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export const EXPLORER_COUNTRIES: ExplorerCountry[] = isoCountries
  .map(({ code, name }) => known.get(code.toLowerCase()) ?? {
    code: code.toLowerCase(),
    name: name.replace(/\s+\(the\)$/i, ""),
  })
  .sort((a, b) => {
    const left = sortKey(a.name);
    const right = sortKey(b.name);
    return left < right ? -1 : left > right ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
