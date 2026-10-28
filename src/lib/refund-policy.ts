// This describes one simulated catalog plan, not a live-provider guarantee.
export const PREVIEW_SINGLE_NUMBER_WINDOW = "Single verification · 20 min window";

export function isPreviewSingleNumberWithoutCode(order: {
  provider: string;
  service: string;
  duration: string;
  otpCode: string | null;
}): boolean {
  return order.provider === "simulated" && order.service === "numbers" &&
    order.duration === PREVIEW_SINGLE_NUMBER_WINDOW && order.otpCode == null;
}
