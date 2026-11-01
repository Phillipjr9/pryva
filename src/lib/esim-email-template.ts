import "server-only";

import type { EmailAttachment } from "@/lib/esim-qr";
import type { ResendPayload } from "@/lib/wallet-email-template";

/**
 * The eSIM handover email.
 *
 * The order page already shows the QR and the activation string, but a page is
 * not a delivery: close the tab, sign out, or buy on a laptop and install on a
 * phone, and the only copy of the profile is behind a login. This puts the same
 * material in the inbox, which is where people look when they are standing in an
 * airport with a phone in one hand.
 *
 * The design is deliberately dimensional — layered gradients, inset highlights
 * and long soft shadows — because the QR is the one thing on the page that must
 * read as a physical object to be scanned. Everything degrades: a client that
 * strips `box-shadow` (Gmail) still gets the gradients, the borders and the
 * instructions, and a client that blocks `cid:` images still gets the code as
 * text.
 */

const C = {
  ink: "#241b3a",
  ink2: "#5b4f6b",
  ink3: "#8a7f97",
  lav: "#8266C9",
  lavLight: "#b49ce7",
  cream: "#faf7f1",
  card: "#fffdfa",
  line: "#e7e0ee",
  gold: "#c8a24a",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export type EsimDeliveryInput = {
  recipient: string;
  sender: string;
  orderReference: string;
  productName: string;
  planLabel: string;
  region: string;
  duration: string;
  /** `LPA:1$…` — the profile itself, and the QR payload. */
  activationCode: string;
  installUrl: string | null;
  iccid: string | null;
  orderUrl: string;
  attachment: EmailAttachment | null;
};

/** A chunky, dimensional button: gradient face, inner highlight, cast shadow. */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
    <td style="border-radius:14px;background:linear-gradient(135deg,#8266C9 0%,#6f52b8 55%,#9a7ee0 100%);box-shadow:0 14px 26px -10px rgba(60,40,110,0.75),inset 0 1px 0 rgba(255,255,255,0.45),inset 0 -2px 0 rgba(0,0,0,0.18);">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.2px;color:#ffffff;text-decoration:none;">${label}</a>
    </td>
  </tr></table>`;
}

function step(index: number, title: string, body: string): string {
  return `<tr>
    <td style="padding:0 0 16px;vertical-align:top;width:44px;">
      <div style="width:30px;height:30px;border-radius:10px;text-align:center;line-height:30px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(160deg,#8f74d6,#6a4fb3);box-shadow:0 8px 16px -8px rgba(70,45,120,0.9),inset 0 1px 0 rgba(255,255,255,0.5);">${index}</div>
    </td>
    <td style="padding:0 0 16px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:${C.ink};">${esc(title)}</p>
      <p style="margin:0;font-size:13px;line-height:1.65;color:${C.ink2};">${body}</p>
    </td>
  </tr>`;
}

export function makeEsimDeliveryEmail(input: EsimDeliveryInput): ResendPayload {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipient) || input.recipient.length > 200) {
    throw new Error("Invalid notification data");
  }
  if (!input.sender || input.sender.length > 255 || /[\r\n]/.test(input.sender)) {
    throw new Error("Invalid notification data");
  }
  const code = input.activationCode.trim();
  if (!code || code.length > 1_200) throw new Error("Invalid notification data");

  const name = clip(input.productName, 120);
  const plan = clip(input.planLabel, 120);
  const region = clip(input.region, 80);
  const duration = clip(input.duration, 80);
  const reference = clip(input.orderReference, 40);
  const iccid = input.iccid ? clip(input.iccid, 40) : null;
  const installUrl = input.installUrl && /^https:\/\//.test(input.installUrl) ? input.installUrl : null;
  const hasQr = Boolean(input.attachment);

  const subject = `Your eSIM is ready — ${name}`;
  const preheader = `${plan} · scan the QR or paste the activation code to install.`;

  const text = [
    `Your eSIM is ready.`,
    ``,
    `${name} — ${plan} (${region}, ${duration})`,
    `Order reference: ${reference}`,
    iccid ? `ICCID: ${iccid}` : "",
    ``,
    `Install it:`,
    `1. Make sure the device is connected to the internet.`,
    `2. Open Settings → Mobile data (or Cellular) and choose "Add eSIM".`,
    `3. Scan the QR code attached to this email, or choose "Enter details manually" and paste the activation code below.`,
    `4. Label the line Pryva and turn on data roaming while you travel.`,
    ``,
    `Activation code (keep it private):`,
    code,
    ``,
    installUrl ? `One-tap install (iOS): ${installUrl}` : "",
    ``,
    `Anyone with this code can install the plan, so please don't forward this email or post screenshots of it.`,
    `Your profile is also on your order page: ${input.orderUrl}`,
    ``,
    `Pryva Technologies · Lagos, Nigeria`,
  ].filter((line) => line !== "").join("\n");

  const qrBlock = hasQr
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:10px;border-radius:22px;background:linear-gradient(150deg,#ffffff 0%,#f1ecfb 45%,#d9cdf3 100%);box-shadow:0 26px 44px -20px rgba(45,30,80,0.65),inset 0 1px 0 rgba(255,255,255,0.95),inset 0 -2px 0 rgba(120,95,175,0.25);">
          <div style="padding:10px;border-radius:16px;background:#ffffff;box-shadow:inset 0 2px 6px rgba(60,40,110,0.16);">
            <img src="cid:esim-qr" width="220" height="220" alt="eSIM installation QR code" style="display:block;width:220px;height:220px;border:0;outline:none;border-radius:8px;">
          </div>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;text-align:center;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${C.ink3};">Point the camera at this code, or use the installer button below.</p>`
    : `<p style="margin:0;text-align:center;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:${C.ink2};">Open your order page to view the QR code, or paste the activation code below into <strong>Add eSIM → Enter details manually</strong>.</p>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Manrope:wght@700;800&display=swap">
<style>@media only screen and (max-width:620px){.shell{width:100% !important;} .pad{padding-left:18px !important;padding-right:18px !important;}}</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.cream};">${esc(preheader)}&#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#f4efe6 0%,#faf7f1 45%,#f6f2ec 100%);">
<tr><td align="center" style="padding:34px 14px 10px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="shell" style="width:600px;max-width:100%;">
  <tr><td class="pad" style="padding:0 8px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px;vertical-align:middle;"><img src="${esc(input.orderUrl.replace(/\/dashboard.*$/, ""))}/images/brand/pryva-mark.png" width="30" height="30" alt="Pryva" style="display:block;border:0;border-radius:9px;"></td>
      <td style="font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:21px;font-weight:800;letter-spacing:-1.2px;color:${C.ink};vertical-align:middle;">Pryva</td>
    </tr></table>
  </td></tr>

  <tr><td class="pad" style="padding:0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:26px;background:linear-gradient(155deg,#3a2b63 0%,#241b3a 52%,#4b3480 100%);box-shadow:0 30px 55px -24px rgba(30,20,55,0.8),inset 0 1px 0 rgba(255,255,255,0.22);">
      <tr><td style="padding:34px 30px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:999px;background:linear-gradient(160deg,rgba(255,255,255,0.28),rgba(255,255,255,0.08));box-shadow:inset 0 1px 0 rgba(255,255,255,0.55);padding:7px 14px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#f3ecff;">Ready to install</td>
        </tr></table>
        <h1 style="margin:16px 0 8px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-1px;color:#ffffff;">Your eSIM is ready</h1>
        <p style="margin:0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#d9cff0;">${esc(name)} — ${esc(plan)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr>
          <td style="padding:9px 14px;margin-right:8px;border-radius:12px;background:rgba(255,255,255,0.10);box-shadow:inset 0 1px 0 rgba(255,255,255,0.3);font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#efe9ff;">${esc(region)}</td>
          <td style="width:8px;"></td>
          <td style="padding:9px 14px;border-radius:12px;background:rgba(255,255,255,0.10);box-shadow:inset 0 1px 0 rgba(255,255,255,0.3);font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#efe9ff;">${esc(duration)}</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" style="padding:22px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:24px;background:${C.card};border:1px solid ${C.line};box-shadow:0 22px 40px -26px rgba(45,30,80,0.55),inset 0 1px 0 #ffffff;">
      <tr><td style="padding:26px 24px 8px;">
        ${qrBlock}
        <div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>
        ${installUrl ? button(installUrl, "Install on this iPhone") : ""}
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:24px;background:${C.card};border:1px solid ${C.line};box-shadow:0 22px 40px -26px rgba(45,30,80,0.5),inset 0 1px 0 #ffffff;">
      <tr><td style="padding:24px 24px 10px;">
        <p style="margin:0 0 18px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:${C.ink};">Install in four steps</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${step(1, "Use a connection", "Stay on Wi-Fi or mobile data — the profile downloads during setup.")}
          ${step(2, "Add the eSIM", "Settings → Mobile data (Cellular on iPhone) → <strong>Add eSIM</strong>.")}
          ${step(3, "Scan or paste", hasQr ? "Scan the QR code above, or choose <strong>Enter details manually</strong> and paste the activation code below." : "Choose <strong>Enter details manually</strong> and paste the activation code below.")}
          ${step(4, "Switch data on", "Label the line Pryva, then enable data roaming while you travel.")}
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:24px;background:linear-gradient(160deg,#f7f3fc 0%,#efe9fa 100%);border:1px solid #e3daf5;box-shadow:0 18px 34px -24px rgba(60,40,110,0.55),inset 0 1px 0 #ffffff;">
      <tr><td style="padding:22px 24px;">
        <p style="margin:0 0 10px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${C.lav};">Manual activation code</p>
        <div style="border-radius:14px;background:#ffffff;border:1px solid #e6ddf6;box-shadow:inset 0 2px 6px rgba(60,40,110,0.12);padding:14px 16px;">
          <code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.7;color:${C.ink};word-break:break-all;">${esc(code)}</code>
        </div>
        ${iccid ? `<p style="margin:12px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${C.ink3};">ICCID ${esc(iccid)} · Reference ${esc(reference)}</p>` : `<p style="margin:12px 0 0;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${C.ink3};">Reference ${esc(reference)}</p>`}
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" style="padding:20px 8px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;background:#fff8e8;border:1px solid #f0e0bd;box-shadow:inset 0 1px 0 #fffdf6;">
      <tr><td style="padding:16px 18px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#7a5f22;">
        <strong>Keep this private.</strong> Anyone with this QR or code can install the plan. Don&apos;t forward this email or share screenshots of it — if it leaks, contact support and we&apos;ll help you reissue.
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" class="pad" style="padding:26px 8px 0;">
    ${button(input.orderUrl, "Open my order")}
  </td></tr>

  <tr><td align="center" style="padding:30px 24px 36px;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${C.ink3};">
    Questions? Reply to this email or use the <a href="${esc(input.orderUrl.replace(/\/dashboard.*$/, ""))}/help" style="color:${C.lav};font-weight:600;text-decoration:none;">help center</a>.
    <br><br>Pryva Technologies · Lagos, Nigeria<br>&#169; ${new Date().getFullYear()} Pryva Technologies
  </td></tr>
</table>

</td></tr></table>
</body></html>`;

  return {
    from: input.sender,
    to: [input.recipient],
    subject,
    text,
    html,
    ...(input.attachment ? { attachments: [input.attachment] } : {}),
  };
}

export const ESIM_DELIVERY_GOLD = C.gold;
