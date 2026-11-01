import "server-only";

import QRCode from "qrcode";
import type { ResendAttachment } from "@/lib/wallet-email-template";

/**
 * The QR the customer scans to install the plan.
 *
 * The activation string (`LPA:1$…`) *is* the payload — the supplier hosts no
 * image — so the code is generated here rather than linked. That also means the
 * image can be attached to the email: a QR that only exists behind a signed URL
 * is a QR that stops working when the URL is rotated or the mailbox is opened
 * months later.
 */

export type EmailAttachment = ResendAttachment;

/** Anything longer than this is not a profile payload, it is a bug. */
const MAX_PAYLOAD = 1_200;

export async function esimQrAttachment(payload: string): Promise<EmailAttachment | null> {
  const text = payload.trim();
  if (!text || text.length > MAX_PAYLOAD) return null;

  try {
    const png = await QRCode.toBuffer(text, {
      type: "png",
      width: 640,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#241b3a", light: "#ffffff" },
    });
    return {
      filename: "pryva-esim-qr.png",
      content: png.toString("base64"),
      // Referenced from the HTML as `cid:esim-qr`; clients that ignore it still
      // get a downloadable PNG under a human filename.
      content_id: "esim-qr",
    };
  } catch {
    // A QR we cannot draw must not cost the customer the instructions.
    return null;
  }
}
