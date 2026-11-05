import { isPreviewDatabase } from "@/lib/platform/demo-policy";

/**
 * Guard for purchase and payment paths: no supplier spend or payment processing
 * from an ephemeral database or a Vercel preview. It must be used by each path;
 * it does not make a preview globally read-only or repair historical balances.
 */
export function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function financialActionsUnavailable(): boolean {
  return isPreviewDatabase() || isVercelPreview();
}
