import { createHmac, timingSafeEqual } from "node:crypto";

/** Paystack signs the exact raw request body, not the parsed JSON. */
export function verifyPaystackSignature(body: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(body, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
