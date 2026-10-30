import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comparePayoutNames, normalizePayoutName } from "@/lib/withdrawal-name-check";

/**
 * The comparison that decides whether money may leave the platform.
 *
 * Route-level coverage of the refusal lives in withdrawal-security.test.ts; these
 * pin the rules themselves, because every case here is a judgement call about
 * which error is worse. The answer chosen throughout is that refusing a genuine
 * customer is recoverable and paying a third party is not, so the accepted cases
 * are only the ones that are unambiguously the same name.
 */
describe("normalizePayoutName", () => {
  it("reduces a bank record to comparable tokens", () => {
    expect(normalizePayoutName("  OBI,  ADA-Chukwu ")).toEqual(["obi", "ada", "chukwu"]);
  });

  it("drops accents, so a name is not refused over keyboard differences", () => {
    expect(normalizePayoutName("Ádá Ọ̀bị̀")).toEqual(["ada", "obi"]);
  });

  it("drops titles, which are not part of a name", () => {
    expect(normalizePayoutName("Chief Dr Ada Obi")).toEqual(["ada", "obi"]);
  });

  it("keeps a name that is only digits distinguishable from an empty one", () => {
    expect(normalizePayoutName("---")).toEqual([]);
  });
});

describe("comparePayoutNames", () => {
  const same = [
    ["Ada Obi", "ADA OBI"],
    ["Ada Obi", "OBI ADA"], // banks commonly record surname first
    ["Ada Obi", "Ada Obi Chukwuemeka"], // bank record fuller than the signup name
    ["Ada Obi Chukwuemeka", "ADA OBI"], // and the other way round
    ["Chief Ada Obi", "ADA OBI"],
    ["Ada  Obi", "ada obi"],
  ];

  it.each(same)("accepts %j against %j", (depositor, destination) => {
    expect(comparePayoutNames(depositor, destination)).toEqual({ ok: true });
  });

  const different = [
    ["Ada Obi", "Bola Adeyemi"], // a different person entirely
    ["Ada Obi", "CHINEDU OBI"], // one shared surname is not identity
    ["Ada Obi", "ADA OBINNA"], // a near miss is still a different name
    ["Ada Obi", "Ada"], // too little overlap to prove anything
    ["Ada Obi", "OBI"],
    ["Ada", "Ada Obi"],
    ["Ada Obi", "Ada Obi Chukwu Obiora"], // two extra names is not a middle name
  ];

  it.each(different)("refuses %j against %j", (depositor, destination) => {
    expect(comparePayoutNames(depositor, destination).ok).toBe(false);
  });

  it("refuses a third party outright", () => {
    expect(comparePayoutNames("Ada Obi", "Bola Adeyemi")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("treats an unrecorded depositor as a refusal, not a match", () => {
    expect(comparePayoutNames(null, "ADA OBI")).toEqual({ ok: false, reason: "no-deposit" });
    expect(comparePayoutNames("   ", "ADA OBI")).toEqual({ ok: false, reason: "no-deposit" });
  });

  it("refuses a destination with no name on record", () => {
    expect(comparePayoutNames("Ada Obi", null)).toEqual({ ok: false, reason: "no-name" });
    expect(comparePayoutNames("Ada Obi", "###")).toEqual({ ok: false, reason: "no-name" });
  });

  it("survives values that are not strings at all", () => {
    // The column is nullable and the provider's response is cast, so a malformed
    // value must fail the check rather than throw inside a withdrawal request.
    expect(comparePayoutNames(undefined as unknown as null, "ADA OBI")).toEqual({ ok: false, reason: "no-deposit" });
  });
});

/**
 * Every PGlite fixture hardcodes the migration list it replays, so a new
 * migration that is not added to all of them leaves those suites running against
 * a stale schema -- passing green while testing a database production will never
 * have. This turns that into a loud failure.
 */
describe("migration fixtures", () => {
  const migrations = readdirSync(join(process.cwd(), "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const fixtures = [
    "src/test/financial-auth-integration.test.ts",
    "src/test/order-idempotency.test.ts",
    "src/test/purchase-pricing-e2e.test.ts",
    "src/test/wallet-email.test.ts",
  ];

  it("finds the migration files", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(13);
    expect(migrations).toContain("0012_topup_payer_name.sql");
  });

  it.each(fixtures)("%s replays every migration", (fixture) => {
    const source = readFileSync(join(process.cwd(), fixture), "utf8");
    const missing = migrations.filter((file) => !source.includes(file));
    expect(missing, `${fixture} never applies: ${missing.join(", ")}`).toEqual([]);
  });
});
