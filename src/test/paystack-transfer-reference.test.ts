import { describe, expect, it } from "vitest";
import { paystackTransferReference } from "@/lib/paystack-transfer-reference";

describe("Paystack transfer references", () => {
  it("derives a stable, distinct, lowercase provider reference from each withdrawal UUID", () => {
    const first = paystackTransferReference("9A9963B6-4C1E-4C92-8214-EA901643DABA");
    const second = paystackTransferReference("47a7c568-8781-416b-8393-57ed13b89d42");
    expect(first).toBe("wd-9a9963b64c1e4c928214ea901643daba");
    expect(first).toMatch(/^[a-z0-9_-]{16,50}$/);
    expect(second).not.toBe(first);
    expect(() => paystackTransferReference("WD-old-reference")).toThrow();
  });
});
