import "server-only";

import type { ResendPayload } from "@/lib/wallet-email-template";

/**
 * "Your boost finished."
 *
 * Boosts are the slow product. A number arrives in seconds and an eSIM in
 * minutes, so a customer is plausibly still on the page; a boost runs for hours
 * or days, which means the moment it completes is the moment nobody is looking.
 * Until this existed, a finished boost was visible only to a customer who
 * re-opened the order page out of curiosity, and the nightly sweep that marks it
 * delivered had nowhere to tell anyone.
 *
 * What it deliberately does *not* contain: the panel, the panel's order id, the
 * supplier's status vocabulary or anything about how the units were delivered.
 * A customer bought a boost on a link; they get confirmation about that link.
 * The link itself is theirs, so it is printed and never turned into a clickable
 * anchor — a URL inside an email we send is the one thing a phishing filter is
 * right to be suspicious of.
 */

const C = {
  ink: "#241b3a",
  ink2: "#5b4f6b",
  ink3: "#8a7f97",
  lav: "#8266C9",
  cream: "#faf7f1",
  card: "#fffdfa",
  line: "#e7e0ee",
  good: "#1f7a4d",
  goodBg: "#eefaf1",
  goodLine: "#c6e7d3",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export type BoostCompleteInput = {
  recipient: string;
  sender: string;
  orderReference: string;
  productName: string;
  planLabel: string;
  /** Units bought. Null on a legacy row that predates the column. */
  quantity: number | null;
  /** The post or profile the customer ordered growth for. Theirs, not ours. */
  targetLink: string | null;
  orderUrl: string;
};

export function makeBoostCompleteEmail(input: BoostCompleteInput): ResendPayload {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) || input.recipient.length > 200) {
    throw new Error("Invalid notification data");
  }
  if (!input.sender || input.sender.length > 255 || /[\r\n]/.test(input.sender)) {
    throw new Error("Invalid notification data");
  }
  if (input.quantity !== null && (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 100_000_000)) {
    throw new Error("Invalid notification data");
  }

  const name = clip(input.productName, 120);
  const plan = clip(input.planLabel, 120);
  const reference = clip(input.orderReference, 40);
  const target = input.targetLink ? clip(input.targetLink, 200) : null;
  const units = input.quantity === null ? null : input.quantity.toLocaleString("en-NG");
  const amountLine = units && plan ? `${units} × ${plan}` : plan;

  const subject = `Your boost is complete — ${reference}`;
  const text = [
    `Your boost has finished.`,
    ``,
    `${name} — ${amountLine}`,
    target ? `Delivered to: ${target}` : "",
    `Order reference: ${reference}`,
    ``,
    `The order page shows the final count and keeps it for your records.`,
    `View the order: ${input.orderUrl}`,
    ``,
    `Delivered less than you ordered? Reply to this email with the reference and we will check it against the delivery record.`,
    `Pryva Technologies · Lagos, Nigeria`,
  ].filter((line) => line !== "").join("\n");

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Manrope:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#f4efe6 0%,#faf7f1 50%,#f6f2ec 100%);">
<tr><td align="center" style="padding:34px 14px 10px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;">
  <tr><td style="padding:0 8px 18px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-1.2px;color:${C.ink};">Pryva</td></tr>

  <tr><td style="padding:0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:26px;background:linear-gradient(155deg,#3a2b63 0%,#241b3a 55%,#4b3480 100%);box-shadow:0 28px 52px -24px rgba(30,20,55,0.8),inset 0 1px 0 rgba(255,255,255,0.22);">
      <tr><td style="padding:32px 28px 30px;">
        <p style="margin:0 0 10px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#cfc2ee;">Delivery complete</p>
        <h1 style="margin:0 0 6px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.8px;color:#ffffff;">Your boost has finished</h1>
        <p style="margin:0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#d9cff0;">${esc(name)}</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:24px;background:${C.card};border:1px solid ${C.line};box-shadow:0 22px 40px -26px rgba(45,30,80,0.55),inset 0 1px 0 #ffffff;">
      <tr><td style="padding:26px 24px;">
        <div style="border-radius:18px;background:${C.goodBg};border:1px solid ${C.goodLine};padding:18px 18px;">
          <p style="margin:0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.good};">Delivered</p>
          <p style="margin:6px 0 0;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.6px;color:${C.ink};">${esc(amountLine || name)}</p>
        </div>
        ${target ? `<p style="margin:16px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${C.ink3};">Delivered to<br><span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:${C.ink2};word-break:break-all;">${esc(target)}</span></p>` : ""}
        <p style="margin:16px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${C.ink2};">The order page keeps the final count and the delivery record in case you need it later.</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:26px 8px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="border-radius:14px;background:linear-gradient(135deg,#8266C9 0%,#6f52b8 55%,#9a7ee0 100%);box-shadow:0 14px 26px -10px rgba(60,40,110,0.75),inset 0 1px 0 rgba(255,255,255,0.45);">
        <a href="${esc(input.orderUrl)}" style="display:inline-block;padding:13px 24px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;">Open my order</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td align="center" style="padding:26px 24px 34px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${C.ink3};">
    Order ${esc(reference)}<br><br>
    Delivered less than you ordered? Reply with the reference and we&apos;ll check it against the delivery record.<br><br>
    Pryva Technologies · Lagos, Nigeria
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { from: input.sender, to: [input.recipient], subject, text, html };
}
