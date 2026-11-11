import { isPreviewDatabase } from "@/lib/platform/demo-policy";

/**
 * Local-only override for preview environments that need a live supplier catalogue
 * visible while staying out of production. This is intentionally not enabled in
 * deployed previews.
 */
export function forceLiveListings(): boolean {
  return ["1", "true", "yes"].includes((process.env.FORCE_LIVE_LISTINGS ?? "").trim().toLowerCase());
}

/**
 * Guard for purchase and payment paths: no supplier spend or payment processing
 * from an ephemeral database or a Vercel preview. It must be used by each path;
 * it does not make a preview globally read-only or repair historical balances.
 */
export function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function financialActionsUnavailable(): boolean {
  if (forceLiveListings()) return false;
  return isPreviewDatabase() || isVercelPreview();
}
