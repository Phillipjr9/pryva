import "server-only";

import type { ResendPayload } from "@/lib/wallet-email-template";

/**
 * "Your code arrived."
 *
 * Until now a verification code only existed on the order page, which is fine
 * while the page is open and useless the moment it is not — the customer is on
 * another device, in another app, waiting for the SMS that never comes to the
 * handset they can see. Sending the code closes that loop.
 *
 * The code is short-lived and single-use, but it is still a credential: it goes
 * only to the account's own address, the message says so, and nothing else in
 * the order (number, plan, expiry) is secret.
 */

const C = {
  ink: "#241b3a",
  ink2: "#5b4f6b",
  ink3: "#8a7f97",
  lav: "#8266C9",
  cream: "#faf7f1",
  card: "#fffdfa",
  line: "#e7e0ee",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export type NumberCodeInput = {
  recipient: string;
  sender: string;
  orderReference: string;
  productName: string;
  planLabel: string;
  region: string;
  phoneNumber: string | null;
  code: string;
  expiresAt: Date | null;
  orderUrl: string;
};

export function makeNumberCodeEmail(input: NumberCodeInput): ResendPayload {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) || input.recipient.length > 200) {
    throw new Error("Invalid notification data");
  }
  if (!input.sender || input.sender.length > 255 || /[\r\n]/.test(input.sender)) {
    throw new Error("Invalid notification data");
  }
  const code = input.code.trim();
  if (!code || code.length > 32) throw new Error("Invalid notification data");

  const name = clip(input.productName, 120);
  const plan = clip(input.planLabel, 120);
  const region = clip(input.region, 80);
  const reference = clip(input.orderReference, 40);
  const phone = input.phoneNumber ? clip(input.phoneNumber, 32) : null;
  const window = input.expiresAt && Number.isFinite(input.expiresAt.getTime())
    ? input.expiresAt.toISOString().slice(11, 16) + " UTC"
    : null;

  const subject = `Your verification code: ${code}`;
  const text = [
    `Your verification code has arrived.`,
    ``,
    code,
    ``,
    phone ? `Number: ${phone}` : "",
    `${name} — ${plan} (${region})`,
    `Order reference: ${reference}`,
    window ? `The number stops receiving messages around ${window}.` : "",
    ``,
    `Enter this code in the app you are signing up to. It is single-use and expires with the number.`,
    `Nobody at Pryva will ask you for it — don't forward this email.`,
    `View the order: ${input.orderUrl}`,
    ``,
    `If you didn't ask for a number, reply to this email and we'll refund it.`,
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
        <p style="margin:0 0 10px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#cfc2ee;">Code received</p>
        <h1 style="margin:0 0 6px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.8px;color:#ffffff;">Your verification code</h1>
        <p style="margin:0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#d9cff0;">${esc(name)} · ${esc(region)}</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:24px;background:${C.card};border:1px solid ${C.line};box-shadow:0 22px 40px -26px rgba(45,30,80,0.55),inset 0 1px 0 #ffffff;">
      <tr><td style="padding:28px 24px;text-align:center;">
        <div style="border-radius:18px;background:linear-gradient(160deg,#ffffff,#f4efff);border:1px solid #e6ddf6;box-shadow:inset 0 2px 8px rgba(60,40,110,0.14),0 12px 24px -16px rgba(60,40,110,0.7);padding:22px 18px;">
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${C.ink};">${esc(code)}</span>
        </div>
        ${phone ? `<p style="margin:16px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${C.ink2};">Received on <strong style="color:${C.ink};">${esc(phone)}</strong></p>` : ""}
        ${window ? `<p style="margin:6px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${C.ink3};">The number stops receiving messages around ${esc(window)}.</p>` : ""}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;background:#fff8e8;border:1px solid #f0e0bd;box-shadow:inset 0 1px 0 #fffdf6;">
      <tr><td style="padding:16px 18px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#7a5f22;">
        This code is single-use and tied to the number above. Nobody at Pryva will ask you for it — don&apos;t forward this email.
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
    Order ${esc(reference)} · ${esc(plan)}<br><br>
    Didn&apos;t ask for this? Reply and we&apos;ll look after it.<br><br>
    Pryva Technologies · Lagos, Nigeria
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { from: input.sender, to: [input.recipient], subject, text, html };
}
