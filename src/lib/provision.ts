import { randomBytes, randomInt } from "node:crypto";
import type { Plan } from "@/lib/catalog";

function digits(length: number): string {
  return Array.from({ length }, () => randomInt(0, 10)).join("");
}

export function generateOtpCode(): string {
  return digits(6);
}

export function generateReference(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  return `PRY-${stamp}${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type Provisioned = {
  referenceCode: string | null;
  otpCode: string | null;
};

export function provisionPlan(plan: Plan): Provisioned {
  switch (plan.service) {
    case "numbers": {
      // +000 is deliberately non-dialable; a demo must not display someone
      // else's real phone number. The example code arrives separately later.
      return { referenceCode: `+000 555 ${digits(4)}`, otpCode: null };
    }
    case "esim": {
      const handle = randomBytes(5).toString("hex").toUpperCase();
      return {
        referenceCode: [
          "Demo eSIM details (not an active plan)",
          `SM-DP+ address: demo.invalid`,
          `Matching ID: ${handle}`,
          `Activation code: LPA:1$demo.invalid$${handle}`,
          `Plan: ${plan.name} · ${plan.planLabel}`,
        ].join("\n"),
        otpCode: null,
      };
    }
    case "proxies": {
      const user = `pryva_${randomBytes(3).toString("hex")}`;
      const pass = randomBytes(4).toString("hex");
      return {
        referenceCode: [
          "Demo proxy details (not a working connection)",
          `Host: demo.invalid`,
          `Port: 8000 (HTTP/SOCKS5)`,
          `Username: ${user}`,
          `Password: ${pass}`,
          `Region: ${plan.region}`,
          "Rotating per request · sticky sessions up to 30 minutes.",
        ].join("\n"),
        otpCode: null,
      };
    }
    case "email-otp": {
      const label = randomBytes(3).toString("hex");
      return { referenceCode: `demo-${label}@example.test`, otpCode: null };
    }
    default:
      return { referenceCode: "Demo order — no real service was delivered.", otpCode: null };
  }
}

export function expiryForPlan(plan: Plan): Date {
  const now = Date.now();
  const minutesMatch = plan.duration.match(/(\d+)\s*(minute|hour)/i);
  const daysMatch = plan.duration.match(/(\d+)\s*day/i);

  if (minutesMatch) {
    const value = Number(minutesMatch[1]);
    const unitMs = minutesMatch[2].toLowerCase().startsWith("hour") ? 3_600_000 : 60_000;
    return new Date(now + value * unitMs);
  }
  if (daysMatch) {
    return new Date(now + Number(daysMatch[1]) * 86_400_000);
  }
  return new Date(now + 24 * 3_600_000);
}
