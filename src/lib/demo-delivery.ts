import { randomUUID } from "node:crypto";
import { mutatePreviewDatabase } from "@/db";
import { generateOtpCode } from "@/lib/provision";
import { isDemoNumberRental } from "@/lib/demo-service-catalog";

/** Wait long enough to demonstrate the delivery animation, not a real SMS delay. */
export const DEMO_OTP_DELAY_MS = 7000;

export type DemoDelivery = { status: string; otpCode: string | null; waiting: boolean };

/** Deliver one fictional code only to the owner of an eligible demo order. */
export function advanceDemoOtp(userId: string, orderId: string, now = Date.now()): DemoDelivery | null {
  return mutatePreviewDatabase((draft) => {
    const order = draft.orders.find((row) => row.id === orderId && row.userId === userId);
    if (!order || order.provider !== "simulated" || !["numbers", "email-otp"].includes(String(order.service))) return null;
    const status = typeof order.status === "string" ? order.status : "active";
    const current = typeof order.otpCode === "string" ? order.otpCode : null;
    if (current || status !== "active" || order.refundedAt) return { status, otpCode: current, waiting: false };
    const createdAt = new Date((order.demoOtpRequestedAt ?? order.createdAt) as Date | string).getTime();
    const expiresAt = order.expiresAt ? new Date(order.expiresAt as Date | string).getTime() : Infinity;
    if (!Number.isFinite(createdAt) || !Number.isFinite(now) || (expiresAt !== Infinity && !Number.isFinite(expiresAt)) || now >= expiresAt) return { status, otpCode: null, waiting: false };
    if (now < createdAt + DEMO_OTP_DELAY_MS) return { status, otpCode: null, waiting: true };

    const code = generateOtpCode();
    order.otpCode = code;
    if (!isDemoNumberRental(order) && typeof order.demoUnitsRemaining === "number" && Number.isSafeInteger(order.demoUnitsRemaining)) {
      order.demoUnitsRemaining = Math.max(0, order.demoUnitsRemaining - 1);
    }
    draft.notifications.push({
      id: randomUUID(), userId, title: "Demo code received", message: "Your simulated verification code is ready to view in your order.",
      type: "order", read: 0, createdAt: new Date(now),
    });
    return { status, otpCode: code, waiting: false };
  });
}

/** Complete a simulated promotion without contacting a social platform. */
export function advanceDemoPromotion(userId: string, orderId: string, now = Date.now()): DemoDelivery | null {
  return mutatePreviewDatabase((draft) => {
    const order = draft.orders.find((row) => row.id === orderId && row.userId === userId);
    if (!order || order.provider !== "simulated" || order.service !== "social") return null;
    const status = typeof order.status === "string" ? order.status : "processing";
    if (status !== "processing" || order.refundedAt) return { status, otpCode: null, waiting: false };
    const createdAt = new Date(order.createdAt as Date | string).getTime();
    if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return { status, otpCode: null, waiting: false };
    if (now < createdAt + DEMO_OTP_DELAY_MS) return { status, otpCode: null, waiting: true };
    order.status = "delivered";
    order.demoUnitsRemaining = 0;
    order.referenceCode = "Demo campaign complete · fictional profile";
    draft.notifications.push({
      id: randomUUID(), userId, title: "Demo campaign complete", message: "Your simulated promotion has finished.",
      type: "order", read: 0, createdAt: new Date(now),
    });
    return { status: "delivered", otpCode: null, waiting: false };
  });
}
