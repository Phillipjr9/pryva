import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { plans } from "@/lib/services/catalog";
import { isPlanFulfillable } from "@/lib/services/fulfillment";
import { ORDER_PROVIDERS } from "@/lib/services/order-providers";
import {
  LANES,
  ORDER_SERVICE_TAGS,
  SERVICES,
  SERVICE_IDS,
  laneById,
  serviceById,
  type OrderServiceTag,
} from "@/lib/services/registry";
import { EXPLORER_CATEGORIES } from "@/lib/services/service-explorer";
import { SERVICE_LANES } from "@/lib/services/service-coverage";

/**
 * The registry is only useful if nothing keeps a second copy of the vocabulary.
 *
 * Each assertion below pins one of the five lists that used to exist separately
 * — hub shelves, readiness ids, coverage lanes, order tags and delivery windows
 * — against the single declaration. A failure means a family was added, renamed
 * or dropped in one place and not the others, which is how a console ends up
 * reporting "nothing has ever been bought" for a product that is selling.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

/** Every `service: "…"` literal in production code, with the file it came from. */
function orderServiceLiterals(): Array<{ file: string; tag: string }> {
  const found: Array<{ file: string; tag: string }> = [];
  for (const file of [...walk(join(root, "app", "api")), ...walk(join(root, "lib"))]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/service:\s*"([a-z-]+)"/g)) {
      found.push({ file: relative(root, file), tag: match[1] });
    }
  }
  return found;
}

describe("the hub's shelves come from the registry", () => {
  it("presents every family exactly once, in the registry's order", () => {
    expect(EXPLORER_CATEGORIES.map((category) => category.id)).toEqual([...SERVICE_IDS]);
  });

  it("keeps the customer-facing label identical in both places", () => {
    for (const category of EXPLORER_CATEGORIES) {
      expect(category.label, category.id).toBe(serviceById(category.id).label);
    }
  });
});

describe("lanes", () => {
  it("only names lanes the registry declares", () => {
    expect(SERVICE_LANES.map((lane) => lane.id).sort()).toEqual(LANES.map((lane) => lane.id).sort());
  });

  it("reads the credential of a service that actually belongs to the lane", () => {
    for (const lane of LANES) {
      expect(serviceById(lane.configuredBy).lane, `${lane.id} reads an unrelated credential`).toBe(lane.id);
    }
  });

  it("gives every sellable family a lane and a delivery window", () => {
    for (const service of SERVICES) {
      if (service.sale.kind !== "supplier") continue;
      // A tool is a way into another family's lane (a bulk basket buys numbers),
      // so it is accountable through that lane rather than one of its own.
      if (service.sellsInto?.length) continue;
      expect(service.lane, `${service.id} can take money but no lane scores it`).not.toBeNull();
      expect(service.deliveryMinutes, `${service.id} has no delivery window`).toBeGreaterThan(0);
    }
  });

  it("splits a shared supplier by what was bought", () => {
    // eSIM and numbers share one gateway, so provider alone cannot attribute an
    // order. The registry is what makes the split derivable rather than retyped.
    const numbers = SERVICE_LANES.find((lane) => lane.id === "numbers")!;
    const esim = SERVICE_LANES.find((lane) => lane.id === "esim")!;
    expect(numbers.providers).toContain(ORDER_PROVIDERS.bitcall);
    expect(esim.providers).toContain(ORDER_PROVIDERS.bitcall);
    expect(numbers.services).toEqual(["numbers"]);
    expect(esim.services).toEqual(["esim"]);
  });

  it("does not invent a scheduled lane", () => {
    // A scheduled run buys the real plan and records the real supplier, so it has
    // no provider of its own. A lane keyed on `scheduled` could only ever report
    // that nothing had been bought.
    expect(SERVICE_LANES.map((lane) => lane.id)).not.toContain("scheduled");
    expect(orderServiceLiterals().filter(({ tag }) => tag === "scheduled")).toEqual([]);
    expect(() => laneById("scheduled" as never)).toThrow();
  });
});

describe("order tags", () => {
  it("declares every tag a purchase path writes", () => {
    const declared = new Set<string>(ORDER_SERVICE_TAGS);
    for (const { file, tag } of orderServiceLiterals()) {
      expect(declared.has(tag as OrderServiceTag), `${file} writes undeclared service "${tag}"`).toBe(true);
    }
  });

  it("declares a tag for every family that can take money", () => {
    for (const service of SERVICES) {
      if (service.sale.kind !== "supplier") continue;
      if (service.sellsInto?.length) {
        expect(service.sellsInto.every((id) => serviceById(id).orderServices.length > 0)).toBe(true);
        continue;
      }
      expect(service.orderServices.length, `${service.id} takes money but writes no tag`).toBeGreaterThan(0);
    }
  });

  it("writes no provider literal outside the provider table", () => {
    // Provider names are the one thing that must not reach a customer; keeping
    // them in one server-only table is what makes that auditable.
    const known = new Set<string>(Object.values(ORDER_PROVIDERS));
    for (const file of [...walk(join(root, "app", "api")), ...walk(join(root, "lib"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/provider:\s*"([a-z-]+)"/g)) {
        if (match[1] === "mtn" || match[1] === "airtel" || match[1] === "glo" || match[1] === "9mobile") {
          continue; // mobile-network names on a data plan, not an order provider
        }
        expect(known.has(match[1]), `${relative(root, file)} hard-codes provider "${match[1]}"`).toBe(true);
      }
    }
  });
});

describe("the catalogue cannot promise more than the delivery path", () => {
  it("files every plan under a family the registry knows", () => {
    for (const plan of plans) {
      const family = SERVICES.find((service) => service.orderServices.includes(plan.service));
      expect(family, `${plan.slug} is filed under unknown service "${plan.service}"`).toBeDefined();
    }
  });

  it("only calls a plan sellable when a supplier path exists", () => {
    // The two are deliberately separate structures — a price book and a
    // fulfilment allowlist — so this is the assertion that stops them drifting
    // into a paid plan nobody can deliver.
    for (const plan of plans) {
      if (!isPlanFulfillable(plan.slug)) continue;
      const family = SERVICES.find((service) => service.orderServices.includes(plan.service))!;
      expect(family.sale.kind, `${plan.slug} is deliverable but its family is not for sale`).toBe("supplier");
    }
  });
});
