import { afterEach, describe, expect, it, vi } from "vitest";

import { ALL_PROVIDERS, PROVIDERS, configuredProviders, providersFor } from "@/lib/providers";
import { AccsZoneError } from "@/lib/providers/accszone";
import { BitcallError } from "@/lib/providers/bitcall";
import { BulkaccError } from "@/lib/providers/bulkacc";
import { FleexaError } from "@/lib/providers/fleexa";
import { FoxreloadError } from "@/lib/providers/foxreload";
import { SmmPanelError } from "@/lib/providers/smm-panel";
import { TempMailError } from "@/lib/providers/tempmail";
import { PROVIDER_IDS, ProviderError, isFundingFailure, isProviderError, isRefusal, looksLikeFundingRefusal } from "@/lib/providers/types";

/**
 * The supplier boundary.
 *
 * Seven adapters each had their own error class, their own `is…Configured` and no
 * common type, so a caller that wanted "which supplier failed, and may it have
 * bought something?" had to know all seven. These assertions pin the shared part
 * without flattening the differences that are real: each adapter keeps its own
 * codes, and ambiguity stays a per-supplier question.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the provider table", () => {
  it("describes every provider exactly once", () => {
    expect(ALL_PROVIDERS).toHaveLength(PROVIDER_IDS.length);
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id].id, id).toBe(id);
    }
  });

  it("answers 'is it configured?' without throwing, whatever the environment", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(typeof provider.configured(), provider.id).toBe("boolean");
    }
  });

  it("says which order tags a supplier can deliver", () => {
    expect(providersFor("esim").map((provider) => provider.id)).toContain("bitcall");
    expect(providersFor("social").map((provider) => provider.id)).toEqual(["smm"]);
    expect(providersFor("gift-cards").map((provider) => provider.id)).toEqual(["foxreload"]);
    // The temporary inbox is free: it delivers no order, so it supplies no tag.
    expect(PROVIDERS.tempmail.supplies).toEqual([]);
  });

  it("lists only configured suppliers, and names none of them to a customer", () => {
    const configured = configuredProviders();
    expect(configured.every((provider) => provider.configured())).toBe(true);
    for (const provider of ALL_PROVIDERS) {
      // Labels are for the operator console; the customer-facing rule lives in
      // order-providers.ts and is pinned by supplier-secrecy.test.ts.
      expect(provider.label.length).toBeGreaterThan(0);
    }
  });
});

describe("one error type across the boundary", () => {
  const failures: Array<[string, ProviderError]> = [
    ["fleexa", new FleexaError("nope", 503, "NO_API_KEY")],
    ["bitcall", new BitcallError("nope", 502, "UPSTREAM_ERROR", "req-1")],
    ["foxreload", new FoxreloadError("nope", 502)],
    ["accszone", new AccsZoneError("nope", "UPSTREAM_ERROR", 502)],
    ["bulkacc", new BulkaccError("nope", "UPSTREAM_ERROR", 502)],
    ["smm", new SmmPanelError("nope", 502)],
    ["tempmail", new TempMailError("nope")],
  ];

  it("identifies the supplier that failed", () => {
    for (const [id, error] of failures) {
      expect(isProviderError(error), id).toBe(true);
      expect(error.provider, id).toBe(id);
      expect(typeof error.code, id).toBe("string");
      expect(error.code.length, id).toBeGreaterThan(0);
    }
  });

  it("keeps the adapter's own name so an existing catch still recognises it", () => {
    expect(new FleexaError("x", 502).name).toBe("FleexaError");
    expect(new BitcallError("x", 502, "C").name).toBe("BitcallError");
    expect(new FoxreloadError("x", 502).name).toBe("FoxreloadError");
  });

  it("keeps the per-supplier detail that is genuinely per-supplier", () => {
    const bitcall = new BitcallError("x", 502, "VALIDATION_ERROR", "req-9", ["link"], 12);
    expect(bitcall.requestId).toBe("req-9");
    expect(bitcall.fields).toEqual(["link"]);
    expect(bitcall.retryAfterSeconds).toBe(12);
    expect(new AccsZoneError("x", "C", 429, 30).retryAfterSeconds).toBe(30);
  });

  it("tells 'we cannot pay' apart from 'they are down'", () => {
    // An outage is worth retrying; an unfunded account is not. Folding the two
    // together is what made an empty balance look like a broken catalogue.
    expect(isFundingFailure(new FleexaError("x", 402, "INSUFFICIENT_BALANCE"))).toBe(true);
    expect(isFundingFailure(new BitcallError("x", 402, "INSUFFICIENT_BALANCE"))).toBe(true);
    expect(isFundingFailure(new SmmPanelError("x", 502, "PAYMENT_REQUIRED"))).toBe(true);
    expect(isFundingFailure(new FleexaError("x", 502, "UPSTREAM_ERROR"))).toBe(false);
    expect(isFundingFailure(new FleexaError("x", 429, "RATE_LIMITED"))).toBe(false);
    expect(isFundingFailure(new Error("boom"))).toBe(false);
  });

  it("reads an upstream refusal only far enough to classify it", () => {
    for (const text of [
      "Insufficient balance",
      "not enough funds to process this order",
      "Your wallet balance is low",
      "Account unfunded, please top up",
      "You are out of credit",
    ]) expect(looksLikeFundingRefusal(text), text).toBe(true);

    for (const text of [
      "",
      "Service temporarily unavailable",
      "Rate limit exceeded",
      // A credential problem stays a credential problem.
      "Invalid API key. Balance: 999",
      "Unauthorized",
    ]) expect(looksLikeFundingRefusal(text), text).toBe(false);
    expect(looksLikeFundingRefusal(undefined)).toBe(false);
  });

  it("separates a refusal from an unknown outcome", () => {
    // A refusal bought nothing; an unknown outcome may have. Checkout treats the
    // two differently, so the base class must be able to tell them apart.
    expect(isRefusal(new FleexaError("bad request", 400, "VALIDATION_ERROR"))).toBe(true);
    expect(isRefusal(new FleexaError("gateway down", 502, "UPSTREAM_ERROR"))).toBe(false);
    expect(isRefusal(new Error("boom"))).toBe(false);
  });
});
