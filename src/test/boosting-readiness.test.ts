import { describe, expect, it } from "vitest";
import { boostingReadiness, readinessHeadline } from "@/lib/boosting-readiness";

/**
 * The checklist that decides whether boosting can take money. Its whole value is
 * that it says *why* a state is wrong, so the assertions are about the reason,
 * not just the badge.
 */

const base = { keySet: true, endpoint: "https://panel.example/api/v2", markupPercent: 35, fxRate: null };

describe("boosting readiness", () => {
  it("is off, and says so, with no key and no endpoint", () => {
    const readiness = boostingReadiness({ ...base, keySet: false, endpoint: null });
    expect(readiness.configured).toBe(false);
    expect(readiness.steps.find((step) => step.id === "key")?.state).toBe("todo");
    expect(readiness.steps.find((step) => step.id === "endpoint")?.state).toBe("todo");
    expect(readinessHeadline(readiness)).toContain("Boosting is off");
  });

  it("rejects an endpoint that a request must not reach", () => {
    const readiness = boostingReadiness({
      ...base,
      endpoint: "http://127.0.0.1:8080/api",
      endpointProblem: "must be https and outside the network",
    });
    expect(readiness.configured).toBe(false);
    expect(readiness.steps.find((step) => step.id === "endpoint")?.state).toBe("blocked");
    // A blocked endpoint is not the same as a missing one: the operator has set
    // something, and the screen has to say it was refused.
    expect(readiness.steps.find((step) => step.id === "endpoint")?.detail).toContain("outside the network");
  });

  it("shows the host, never the path or a key", () => {
    const readiness = boostingReadiness(base);
    expect(readiness.endpointHost).toBe("panel.example");
    expect(JSON.stringify(readiness)).not.toContain("api/v2");
  });

  it("treats the naira rate as optional until a USD panel needs it", () => {
    const withoutRate = boostingReadiness(base);
    expect(withoutRate.steps.find((step) => step.id === "fx")?.state).toBe("optional");
    expect(readinessHeadline(withoutRate)).toContain("USD");

    const withRate = boostingReadiness({ ...base, fxRate: 1600 });
    expect(withRate.steps.find((step) => step.id === "fx")?.state).toBe("done");
    expect(readinessHeadline(withRate)).toContain("configured");
    // The rate itself is a displayed setting, not a credential: only the key is
    // ever withheld.
    expect(withRate.fxRate).toBe(1600);
  });

  it("always leaves the human step open", () => {
    for (const rate of [null, 1600]) {
      const readiness = boostingReadiness({ ...base, fxRate: rate });
      expect(readiness.steps.find((step) => step.id === "live")?.state).toBe("todo");
      expect(readiness.steps.find((step) => step.id === "live")?.detail).toContain("smallest quantity");
    }
  });
});
