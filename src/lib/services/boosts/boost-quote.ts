import "server-only";
import { createHash } from "node:crypto";
import { MAX_BOOST_QUANTITY, totalForQuantity } from "@/lib/services/boosts/boost-money";
import type { BoostListing } from "@/lib/services/boosts/smm-catalog";

/** Customer-visible terms only; wholesale prices and supplier IDs stay private. */
export function publicBoostQuote(listing: BoostListing) {
  const { id, name, tag, min, max, perThousand } = listing;
  if (!Number.isSafeInteger(min) || min === null || min <= 0 || min > MAX_BOOST_QUANTITY ||
      (max !== null && (!Number.isSafeInteger(max) || max < min)) ||
      perThousand === null || totalForQuantity(perThousand, min) === 0) return null;

  // This is a comparison token, not a price supplied by or trusted from the
  // browser. A later checkout recomputes all terms from its own catalog.
  const terms = createHash("sha256").update(JSON.stringify([id, name, tag, min, max, perThousand])).digest("hex").slice(0, 24);
  return { id, name, tag, min, max, perThousand, terms };
}
