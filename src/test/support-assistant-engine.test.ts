import { describe, expect, it, vi } from "vitest";

import { runSupportEngine, scoreAll } from "@/lib/ai-support/engine";
import { PLAYBOOKS } from "@/lib/ai-support/knowledge";
import type {
  ActionOutcome,
  RemedyId,
  RemedyTarget,
  SupportFacts,
} from "@/lib/ai-support/types";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/**
 * The assistant's thinking, tested as thinking.
 *
 * The engine is pure: facts in, decision out. That means these tests can assert
 * the things that actually matter — that it reads a real pending deposit as the
 * cause, that it refuses to act when the ledger does not back the claim, that it
 * asks instead of guessing at a tie, and that it hands over rather than inventing
 * an answer — without a database, a provider or a network call anywhere.
 */

function facts(overrides: Partial<SupportFacts> = {}): SupportFacts {
  return {
    now: NOW,
    account: {
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      walletBalance: 0,
      twoFactorEnabled: false,
      lockedUntil: null,
      memberSince: new Date("2026-01-01T00:00:00.000Z"),
    },
    ledger: [],
    topUps: [],
    orders: [],
    schedules: [],
    giftCards: [],
    withdrawals: [],
    paymentsReady: true,
    ...overrides,
  };
}

function deps(overrides: {
  runRemedy?: (remedy: RemedyId, target: RemedyTarget) => Promise<ActionOutcome>;
  reload?: () => Promise<SupportFacts>;
} = {}) {
  return {
    runRemedy: overrides.runRemedy ?? vi.fn(async (remedy: RemedyId) => ({
      remedy,
      label: "did it",
      status: "succeeded" as const,
      note: "ok",
    })),
    reload: overrides.reload ?? vi.fn(async () => facts()),
  };
}

function run(message: string, overrides: Partial<SupportFacts> = {}, engineDeps = deps()) {
  return runSupportEngine({ message, facts: facts(overrides), deps: engineDeps });
}

describe("what the assistant reads", () => {
  it("recognises a deposit that has not landed, and names the real one", async () => {
    const result = await run("I paid 5000 an hour ago but my wallet is still empty", {
      topUps: [{ reference: "TOP-abc123", amount: 5000, status: "pending", createdAt: minutesAgo(62), paidAt: null }],
    }, deps({
      reload: async () => facts({
        account: { ...facts().account, walletBalance: 5000 },
        topUps: [{ reference: "TOP-abc123", amount: 5000, status: "completed", createdAt: minutesAgo(62), paidAt: NOW }],
        ledger: [{ type: "credit", amount: 5000, balanceAfter: 5000, description: "Wallet top-up", reference: "TOP-abc123", createdAt: NOW }],
      }),
    }));

    expect(result.playbookId).toBe("deposit-missing");
    expect(result.confidence).toBeGreaterThanOrEqual(0.72);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].remedy).toBe("recheck_topup");
    expect(result.outcome).toBe("fixed");
    expect(result.status).toBe("resolved");
    // The amount in the reply is the amount in the record, not a number the
    // model liked the look of.
    expect(result.reply).toContain("₦5,000");
  });

  it("hands over when the ledger does not confirm the fix it attempted", async () => {
    const result = await run("my deposit never arrived", {
      topUps: [{ reference: "TOP-x", amount: 2500, status: "pending", createdAt: minutesAgo(20), paidAt: null }],
    }, deps({
      runRemedy: async (remedy) => ({ remedy, label: "Re-checked deposit TOP-x", status: "succeeded", note: "provider confirmed" }),
      // Still pending afterwards: the action claims success but the account does
      // not back it, which is exactly when a person must look.
      reload: async () => facts({
        topUps: [{ reference: "TOP-x", amount: 2500, status: "pending", createdAt: minutesAgo(20), paidAt: null }],
      }),
    }));

    expect(result.outcome).toBe("escalated");
    expect(result.status).toBe("escalated");
    expect(result.reply.toLowerCase()).toContain("passing this to a person");
    const verify = result.trace.find((step) => step.kind === "verify");
    expect(verify?.detail).toContain("Not confirmed");
  });

  it("does not credit anything when the provider says the charge is still pending", async () => {
    const result = await run("I paid and nothing showed up", {
      topUps: [{ reference: "TOP-p", amount: 5000, status: "pending", createdAt: minutesAgo(5), paidAt: null }],
    }, deps({
      runRemedy: async (remedy) => ({
        remedy,
        label: "Re-checked deposit TOP-p",
        status: "skipped",
        note: "The provider has not confirmed TOP-p yet (status pending).",
      }),
    }));

    expect(result.reply).toContain("has not confirmed");
    expect(result.reply).toContain("cannot credit the wallet");
    expect(result.reply).toContain("not lost");
    // It must not claim the money arrived, which is the mistake that would cost
    // the customer a second payment.
    expect(result.reply).not.toContain("now shows");
    expect(result.actions[0].status).toBe("skipped");
  });

  it("refuses to re-check when there is no unsettled deposit at all", async () => {
    const runRemedy = vi.fn();
    const result = await run("I paid 10,000 yesterday and it is not in my wallet", {
      topUps: [],
    }, deps({ runRemedy }));

    // Nothing to point the provider at, so nothing is attempted.
    expect(runRemedy).not.toHaveBeenCalled();
    expect(result.outcome).toBe("escalated");
    expect(result.trace.some((step) => step.kind === "act" && step.title === "Could not fix it here")).toBe(true);
  });
});

describe("asking instead of guessing", () => {
  it("asks one question when the message is suggestive but thin", async () => {
    const result = await run("something is wrong with my payment");
    expect(result.outcome).toBe("awaiting_customer");
    expect(result.status).toBe("waiting_on_customer");
    expect(result.reply.trim().endsWith("?")).toBe(true);
  });

  it("does not pick between two schedules it cannot tell apart", async () => {
    const runRemedy = vi.fn();
    const result = await run("cancel my scheduled order please", {
      schedules: [
        { id: "s1", service: "numbers", productLabel: "Virtual Number UK", frequency: "monthly", status: "active", nextRunAt: NOW },
        { id: "s2", service: "proxies", productLabel: "Residential Proxy 5GB", frequency: "weekly", status: "active", nextRunAt: NOW },
      ],
    }, deps({ runRemedy }));

    expect(result.outcome).toBe("awaiting_customer");
    expect(result.reply).toContain("Virtual Number UK");
    expect(result.reply).toContain("Residential Proxy 5GB");
    // Stopping the wrong one would cancel something the customer wants.
    expect(runRemedy).not.toHaveBeenCalled();
  });

  it("stops the one schedule when there is exactly one", async () => {
    const result = await run("please cancel my recurring order", {
      schedules: [
        { id: "s1", service: "numbers", productLabel: "Virtual Number UK", frequency: "monthly", status: "active", nextRunAt: NOW },
      ],
    }, deps({
      reload: async () => facts({
        schedules: [{ id: "s1", service: "numbers", productLabel: "Virtual Number UK", frequency: "monthly", status: "cancelled", nextRunAt: NOW }],
      }),
    }));

    expect(result.actions[0]).toMatchObject({ remedy: "cancel_schedule", status: "succeeded" });
    expect(result.outcome).toBe("fixed");
    expect(result.reply).toContain("stopped");
  });

  it("does not recognise gibberish, and says so", async () => {
    const result = await run("asdf qwerty zxcv");
    expect(result.playbookId).toBe("unrecognised");
    expect(result.outcome).toBe("escalated");
    expect(result.reply).toContain("not going to guess");
  });
});

describe("what it will never do", () => {
  it("quotes no price", async () => {
    const result = await run("how much does a residential proxy cost?");
    expect(result.playbookId).toBe("pricing-question");
    expect(result.outcome).toBe("answered");
    expect(result.reply).not.toMatch(/₦\s?\d/);
    expect(result.reply).toContain("Pricing");
  });

  it("escalates anything that smells like account takeover, urgently", async () => {
    const result = await run("someone hacked my account and I did not make these charges");
    expect(result.category).toBe("account");
    expect(result.priority).toBe("urgent");
    expect(result.outcome).toBe("escalated");
    expect(result.reply).toContain("Settings");
    // It must not claim to have investigated, because it cannot see a keyboard.
    expect(result.reply).toContain("not going to guess at that");
  });

  it("takes 'talk to a person' at face value", async () => {
    const result = await run("I want to speak to a human please");
    expect(result.outcome).toBe("escalated");
    expect(result.reply).toContain("with a person now");
  });

  it("never runs a remedy that was not planned", async () => {
    const plans: string[] = [];
    const result = await run("where is my order?", {
      orders: [{ reference: "PRY-9", service: "numbers", productName: "Virtual Number UK", amount: 1200, status: "active", createdAt: minutesAgo(30), refundedAt: null }],
    }, deps({
      runRemedy: async (remedy) => {
        plans.push(remedy);
        return { remedy, label: "x", status: "succeeded", note: "x" };
      },
    }));
    expect(plans).toEqual([]);
    expect(result.playbookId).toBe("order-problem");
    expect(result.actions).toHaveLength(0);
  });

  it("escalates an order that has been stuck longer than completing one takes", async () => {
    const result = await run("my number is not working, I bought it ages ago", {
      orders: [{ reference: "PRY-77", service: "numbers", productName: "Virtual Number UK", amount: 1200, status: "pending", createdAt: minutesAgo(90), refundedAt: null }],
    });
    expect(result.outcome).toBe("escalated");
    expect(result.reply).toContain("PRY-77");
  });

  it("catches a refunded order with no ledger entry instead of reassuring the customer", async () => {
    const result = await run("I was told I would be refunded but I have not received it", {
      orders: [{ reference: "PRY-5", service: "numbers", productName: "UK Number", amount: 900, status: "refunded", createdAt: minutesAgo(200), refundedAt: minutesAgo(100) }],
      ledger: [],
    });
    expect(result.outcome).toBe("escalated");
    expect(result.reply).toContain("discrepancy");
  });

  it("never says supplier, reseller, vendor or wholesale on a customer ticket", async () => {
    const corpus: string[] = [];
    for (const message of [
      "I paid but my wallet was not credited",
      "my order is not working",
      "refund please",
      "how much is a proxy",
      "cancel my schedule",
      "someone hacked my account",
      "hello",
    ]) {
      const result = await run(message, {
        topUps: [{ reference: "TOP-1", amount: 5000, status: "pending", createdAt: minutesAgo(30), paidAt: null }],
        orders: [{ reference: "PRY-1", service: "numbers", productName: "UK Number", amount: 500, status: "active", createdAt: minutesAgo(10), refundedAt: null }],
        schedules: [{ id: "s1", service: "numbers", productLabel: "UK Number", frequency: "monthly", status: "active", nextRunAt: NOW }],
      });
      corpus.push(result.reply);
    }
    const joined = corpus.join("\n");
    expect(joined).not.toMatch(/supplier|resell|wholesale|vendor|upstream|our cost/i);
  });
});

describe("how the reasoning is recorded", () => {
  it("writes a step for every part of the loop", async () => {
    const result = await run("I paid but my wallet was not credited", {
      topUps: [{ reference: "TOP-z", amount: 1000, status: "pending", createdAt: minutesAgo(15), paidAt: null }],
    }, deps({
      reload: async () => facts({
        account: { ...facts().account, walletBalance: 1000 },
        topUps: [{ reference: "TOP-z", amount: 1000, status: "completed", createdAt: minutesAgo(15), paidAt: NOW }],
        ledger: [{ type: "credit", amount: 1000, balanceAfter: 1000, description: "Wallet top-up", reference: "TOP-z", createdAt: NOW }],
      }),
    }));

    const kinds = result.trace.map((step) => step.kind);
    for (const kind of ["read", "gather", "think", "decide", "act", "verify", "conclude"]) {
      expect(kinds).toContain(kind);
    }
    // The evidence is written out, so an operator can disagree with it.
    expect(result.trace.find((step) => step.kind === "think")?.detail).toContain("deposit has not reached the wallet");
    expect(result.trace.find((step) => step.kind === "verify")?.detail).toContain("Confirmed");
  });

  it("scores every playbook and keeps them ordered", () => {
    const scored = scoreAll(facts(), "I want to talk to a person about a refund");
    expect(scored.length).toBe(PLAYBOOKS.length);
    for (let index = 1; index < scored.length; index += 1) {
      expect(scored[index - 1].score).toBeGreaterThanOrEqual(scored[index].score);
    }
  });

  it("decides the same way twice for the same account and message", async () => {
    const message = "my deposit has not shown up";
    const overrides = {
      topUps: [{ reference: "TOP-d", amount: 3000, status: "pending" as const, createdAt: minutesAgo(45), paidAt: null }],
    };
    const first = await run(message, overrides);
    const second = await run(message, overrides);
    expect(second.playbookId).toBe(first.playbookId);
    expect(second.confidence).toBe(first.confidence);
    expect(second.reply).toBe(first.reply);
  });
});
