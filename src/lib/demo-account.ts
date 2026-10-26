import type { User } from "@/db/schema";

export const DEMO_EMAIL = "demo@pryva.ng";
export const DEMO_PASSWORD = "pryva-demo-2026";
export const DEMO_SESSION_TOKEN = "pryva-preview-demo-session-v1";
export const DEMO_STARTING_BALANCE = 25_000;

/** A safe, database-free account used only when the app runs in preview mode. */
export const DEMO_USER: User = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ada Demo",
  email: DEMO_EMAIL,
  passwordHash: "demo-account-only",
  walletBalance: DEMO_STARTING_BALANCE,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
};
