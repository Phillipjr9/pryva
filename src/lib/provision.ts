import { randomBytes, randomInt } from "node:crypto";
import type { Plan } from "@/lib/catalog";

const regionPrefixes: Record<string, string> = {
  Nigeria: "+234 812",
  "United States": "+1 415",
  "United Kingdom": "+44 7400",
  Canada: "+1 647",
  Germany: "+49 1512",
  Ghana: "+233 24",
  India: "+91 9810",
  "Any 5 countries": "+234 812",
};

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
      const prefix = regionPrefixes[plan.region] ?? "+1 415";
      const number = `${prefix} ${digits(3)} ${digits(4)}`;
      return { referenceCode: number, otpCode: generateOtpCode() };
    }
    case "esim": {
      const handle = randomBytes(5).toString("hex").toUpperCase();
      return {
        referenceCode: [
          "eSIM activation details",
          `SM-DP+ address: rsp.fleexa.net`,
          `Matching ID: ${handle}`,
          `Activation code: LPA:1$rsp.fleexa.net$${handle}`,
          `Plan: ${plan.name} · ${plan.planLabel}`,
          "Scan the QR in the Pryva app (this preview shows the manual details).",
        ].join("\n"),
        otpCode: null,
      };
    }
    case "proxies": {
      const user = `pryva_${randomBytes(3).toString("hex")}`;
      const pass = randomBytes(4).toString("hex");
      return {
        referenceCode: [
          "Residential proxy credentials",
          `Host: gate.pryva.ng`,
          `Port: 8000 (HTTP/SOCKS5)`,
          `Username: ${user}`,
          `Password: ${pass}`,
          `Region: ${plan.region}`,
          "Rotating per request · sticky sessions up to 30 minutes.",
        ].join("\n"),
        otpCode: null,
      };
    }
    default: {
      const label = randomBytes(3).toString("hex");
      const code = generateOtpCode();
      return {
        referenceCode: [
          "Temporary inbox",
          `Address: ${label}@pryva.ink`,
          "",
          "Latest message · Google",
          "Subject: Verify your email address",
          `Verification code: ${code}`,
          "",
          "Use the address above anywhere you need a signup. New mail appears here live.",
        ].join("\n"),
        otpCode: code,
      };
    }
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
