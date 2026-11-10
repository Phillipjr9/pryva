import { test } from "vitest";
import { strict as assert } from "node:assert";
import { auditCatalogues } from "./audit-service-artwork.mjs";

test("classifies live and digital catalogue artwork without exporting account details", () => {
  const result = auditCatalogues([
    { ok: true, partial: true, items: [
      { name: "Example", category: "verification", artwork: { kind: "service", name: "numbers" }, myUnits: 99, id: "private-id" },
      { name: "Example", category: "verification", artwork: { kind: "unidentified-inbox" } },
      { name: "Real Brand", category: "social", artwork: { kind: "brand", name: "instagram" } },
    ] },
    { ok: true, nextCursor: "next", items: [
      { name: "Unknown voucher", id: "digital-id" },
      { name: "Known voucher", artwork: { kind: "local", key: "astropay" } },
      { name: "Known game", artwork: { kind: "digital-product", art: { kind: "category", key: "genshin-impact" } } },
    ] },
  ]);
  assert.equal(result.totalRows, 6);
  assert.equal(result.summary["verification | missing or generic"], 2);
  assert.equal(result.summary["social | mapped: brand"], 1);
  assert.equal(result.summary["digital or unspecified | mapped: digital local"], 1);
  assert.equal(result.summary["digital or unspecified | mapped: digital category"], 1);
  assert.deepEqual(result.missing.find((item) => item.name === "Example"), { category: "verification", name: "Example", count: 2 });
  assert.equal(result.warnings.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-id|digital-id|myUnits|99/);
});

test("refuses failed or malformed responses rather than claiming full coverage", () => {
  assert.throws(() => auditCatalogues([]));
  assert.throws(() => auditCatalogues([{ error: "unavailable" }]));
  assert.throws(() => auditCatalogues([{ ok: true, items: [{}] }]));
  assert.ok(auditCatalogues([{ ok: true, live: false, items: [] }]).warnings.length);
});
