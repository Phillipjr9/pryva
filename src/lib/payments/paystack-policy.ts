/** Refuse simulated or unknown Paystack keys on production deployments. */
export function paystackKeyUsable(key: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = key?.trim();
  if (!secret) return false;
  const production = env.VERCEL_ENV === "production" || (!env.VERCEL_ENV && env.NODE_ENV === "production");
  return !production || (secret.startsWith("sk_live_") && secret.length > "sk_live_".length);
}
