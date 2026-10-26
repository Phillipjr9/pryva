import { DEMO_USER } from "@/lib/demo-account";

/** Opens the database-independent, read-only demo account. */
export async function openDemoAccount() {
  return DEMO_USER;
}
