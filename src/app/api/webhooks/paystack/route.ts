import { hasDatabase } from "@/db";
import {
  isPaystackConfigured,
  settleWalletTopup,
  verifyPaystackWebhookSignature,
} from "@/lib/paystack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabase || !isPaystackConfigured()) {
    return Response.json({ ok: false, error: "Paystack webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return Response.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
  } catch {
    return Response.json({ ok: false, error: "Invalid webhook payload." }, { status: 400 });
  }

  if (event.event !== "charge.success") {
    return Response.json({ ok: true, ignored: true });
  }

  const reference = event.data?.reference;
  if (!reference || !/^[a-z\d-]{1,40}$/i.test(reference)) {
    return Response.json({ ok: false, error: "Missing transaction reference." }, { status: 400 });
  }

  try {
    // The helper verifies the transaction with Paystack and applies the credit
    // in a row-locked DB transaction, so duplicate webhook deliveries are safe.
    const result = await settleWalletTopup(reference);
    return Response.json({ ok: true, status: result.status });
  } catch (error) {
    console.error("Paystack webhook processing failed", error);
    // A non-2xx response lets Paystack retry after transient DB/API failures.
    return Response.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}
