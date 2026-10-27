import { describe, it, expect } from "vitest";
import { generateCode } from "@/lib/gift-cards";

describe("Gift Cards Extended", () => {
  describe("generateCode edge cases", () => {
    it("should always start with PRYVA-", () => {
      for (let i = 0; i < 50; i++) {
        const code = generateCode();
        expect(code.startsWith("PRYVA-")).toBe(true);
      }
    });

    it("should have exactly 4 segments", () => {
      const code = generateCode();
      const segments = code.split("-");
      expect(segments.length).toBe(4);
      expect(segments[0]).toBe("PRYVA");
      expect(segments[1].length).toBe(4);
      expect(segments[2].length).toBe(4);
      expect(segments[3].length).toBe(4);
    });

    it("should only contain valid characters", () => {
      const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let i = 0; i < 50; i++) {
        const code = generateCode();
        const segments = code.split("-").slice(1); // Remove PRYVA prefix
        segments.forEach((segment) => {
          segment.split("").forEach((char) => {
            expect(validChars.includes(char)).toBe(true);
          });
        });
      }
    });

    it("should not contain O, I, or 1", () => {
      for (let i = 0; i < 100; i++) {
        const code = generateCode();
        expect(code).not.toMatch(/[OI1]/);
      }
    });

    it("should generate codes with correct length", () => {
      const code = generateCode();
      expect(code.length).toBe(20); // PRYVA-XXXX-XXXX-XXXX
    });
  });
});
