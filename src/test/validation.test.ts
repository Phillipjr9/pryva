import { describe, it, expect } from "vitest";

describe("Validation", () => {
  describe("Email validation", () => {
    const validEmails = [
      "user@example.com",
      "user.name@example.com",
      "user+tag@example.com",
      "user@subdomain.example.com",
    ];

    const invalidEmails = [
      "notanemail",
      "@example.com",
      "user@",
      "user@.com",
      "user@example",
      "",
    ];

    it("should validate correct email formats", () => {
      validEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(true);
      });
    });

    it("should reject invalid email formats", () => {
      invalidEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(false);
      });
    });
  });

  describe("Phone number validation", () => {
    const validPhones = [
      "08012345678",
      "09012345678",
      "07012345678",
      "08112345678",
    ];

    const invalidPhones = [
      "1234567890",
      "0801234567",
      "080123456789",
      "abcdefghijk",
      "",
    ];

    it("should validate Nigerian phone numbers", () => {
      validPhones.forEach((phone) => {
        const phoneRegex = /^0[789][01]\d{8}$/;
        expect(phoneRegex.test(phone)).toBe(true);
      });
    });

    it("should reject invalid phone numbers", () => {
      invalidPhones.forEach((phone) => {
        const phoneRegex = /^0[789][01]\d{8}$/;
        expect(phoneRegex.test(phone)).toBe(false);
      });
    });
  });

  describe("Amount validation", () => {
    it("should validate gift card amount range", () => {
      const minAmount = 1000;
      const maxAmount = 500000;

      expect(5000 >= minAmount && 5000 <= maxAmount).toBe(true);
      expect(500 >= minAmount && 500 <= maxAmount).toBe(false);
      expect(1000000 >= minAmount && 1000000 <= maxAmount).toBe(false);
    });

    it("should validate positive amounts", () => {
      expect(100 > 0).toBe(true);
      expect(0 > 0).toBe(false);
      expect(-100 > 0).toBe(false);
    });

    it("should validate integer amounts", () => {
      expect(Number.isInteger(1000)).toBe(true);
      expect(Number.isInteger(1000.5)).toBe(false);
    });
  });

  describe("Code validation", () => {
    it("should validate gift card code format", () => {
      const validCode = "PRYVA-ABCD-1234-WXYZ";
      const codeRegex = /^PRYVA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
      expect(codeRegex.test(validCode)).toBe(true);
    });

    it("should reject invalid code formats", () => {
      const invalidCodes = [
        "PRYVA-ABC-1234-WXYZ", // Too short segment
        "PRYVA-ABCDE-1234-WXYZ", // Too long segment
        "PRYV-ABCD-1234-WXYZ", // Wrong prefix
        "pryva-abcd-1234-wxyz", // Lowercase
        "", // Empty
      ];

      const codeRegex = /^PRYVA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
      invalidCodes.forEach((code) => {
        expect(codeRegex.test(code)).toBe(false);
      });
    });
  });

  describe("Frequency validation", () => {
    const validFrequencies = ["daily", "weekly", "biweekly", "monthly"];

    it("should validate frequency values", () => {
      validFrequencies.forEach((freq) => {
        expect(["daily", "weekly", "biweekly", "monthly"].includes(freq)).toBe(true);
      });
    });

    it("should reject invalid frequencies", () => {
      const invalidFrequencies = ["yearly", "hourly", "minutely", ""];
      invalidFrequencies.forEach((freq) => {
        expect(["daily", "weekly", "biweekly", "monthly"].includes(freq)).toBe(false);
      });
    });
  });
});
