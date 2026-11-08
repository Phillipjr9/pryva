import { describe, expect, it } from "vitest";
import { getOrderProgressMessage } from "@/lib/services/order-progress-copy";

describe("order progress copy", () => {
  it("keeps active order instructions neutral and does not mention refunds", () => {
    const message = getOrderProgressMessage("active");

    expect(message).toBe(
      "Delivery has not been confirmed. Please don't place this order again; contact support with your reference if you need help.",
    );
    expect(message).not.toContain("Refunds require verification");
  });
});
