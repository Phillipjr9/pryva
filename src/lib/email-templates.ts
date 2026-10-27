export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
  preheader?: string;
}

// Pryva brand colors and config
const config = {
  primaryColor: "#8266C9",
  primaryGradient: "linear-gradient(90deg,#8266C9,#B49CE7)",
  darkColor: "#29223a",
  textColor: "#29223a",
  textSecondary: "#6b5f74",
  backgroundColor: "#faf7f1",
  cardBackground: "#fffdf9",
  cardBorder: "#e7e0ee",
  infoBackground: "#f8f5ee",
  infoBorder: "#eae5da",
  accentColor: "#8266C9",
  logoUrl: "https://pryva.ng/pryva-logo.png",
  siteUrl: "https://pryva.ng",
};

function emailWrapper(content: string, preheader: string = ""): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <meta name="theme-color" content="${config.backgroundColor}">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap">
  <style>
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; }
      .email-padding { padding-left: 20px !important; padding-right: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${config.backgroundColor};">
  ${preheader ? `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${config.backgroundColor};">${preheader}&#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj; &#847;&zwnj; </div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${config.backgroundColor};">
    <tr><td align="center" style="padding:34px 16px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
  <tr>
    <td style="padding:0 0 22px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="38" style="padding-right:11px;">
          <img src="${config.logoUrl}" width="26" height="26" alt="Pryva" style="display:block;width:26px;height:26px;border:0;outline:none;text-decoration:none;">
        </td>
        <td style="font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:22px;font-weight:700;letter-spacing:-1.3px;color:${config.darkColor};">Pryva</td>
      </tr></table>
    </td>
  </tr>
</table></td></tr>
    ${content}
    <tr><td align="center" style="padding:0 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
  <tr>
    <td align="center" style="padding:30px 24px 36px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.7;color:${config.textSecondary};">
      Questions? Our team is available 24/7 in the
      <a href="${config.siteUrl}/help" style="color:${config.accentColor};font-weight:600;text-decoration:none;">help center</a>
      or right from the app.
      <br><br>
      <a href="${config.siteUrl}/dashboard/settings" style="color:${config.accentColor};font-weight:600;text-decoration:none;">Manage notification settings</a>
      <br><br>
      You're receiving this email because you have a Pryva account.
      <br><br>
      Pryva Technologies &#183; Lagos, Nigeria
      <br><br>
      &#169; ${new Date().getFullYear()} Pryva Technologies
    </td>
  </tr>
</table></td></tr>
  </table>
</body>
</html>`;
}

export function welcomeEmail(name: string, bonusAmount?: number): EmailTemplate {
  const preheader = "Your Pryva account is ready. Start buying virtual numbers, eSIMs, and more.";
  
  const bonusSection = bonusAmount ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:16px 18px;">
      <p style="margin:0;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;color:${config.textColor};">
        <strong>🎉 Welcome Bonus:</strong> We've added <span style="color:${config.accentColor};font-weight:600;">₦${bonusAmount.toLocaleString()}</span> to your wallet!
      </p>
    </td></tr>
  </table>
  ` : "";

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:${config.primaryColor};background-image:${config.primaryGradient};"> </div>
              <img src="${config.siteUrl}/images/email/hero-welcome.jpg" width="600" alt="Welcome to Pryva" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${config.accentColor};">Welcome</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">Your Pryva account is ready</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">Welcome aboard, ${name}. You now have access to virtual numbers, eSIMs, residential proxies, and digital accounts — all paid in Naira with instant delivery.</p>
      
      ${bonusSection}
      
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Virtual Numbers</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">40+ countries</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">eSIM Data</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">190+ destinations</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Residential Proxies</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">Global coverage</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Digital Accounts</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">Netflix, Spotify, ChatGPT</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Payment</td>
        <td align="right" style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">Naira (₦)</td>
      </tr></table>
    </td></tr>
  </table>
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${config.siteUrl}/dashboard" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">Go to Dashboard  &#8594;</a>
      </td>
    </tr>
  </table>
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${config.infoBackground};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">Next step: Top up your wallet to make your first purchase. All payments are in Naira — no dollar card needed!</p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `Welcome to Pryva, ${name}! 🎉`,
    html: emailWrapper(content, preheader),
    text: `Welcome to Pryva, ${name}!\n\nYour account is ready. Start buying virtual numbers, eSIMs, and digital accounts at ${config.siteUrl}/dashboard`,
    preheader,
  };
}

export function orderConfirmationEmail(order: { 
  reference: string; 
  productName: string; 
  amount: number;
  service: string;
  region?: string;
  duration?: string;
}): EmailTemplate {
  const preheader = `Your order ${order.reference} has been confirmed and is being processed.`;

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:${config.primaryColor};background-image:${config.primaryGradient};"> </div>
              <img src="${config.siteUrl}/images/email/hero-order.jpg" width="600" alt="Order Confirmed" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#4caf50;">Confirmed</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">Your order is confirmed</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">Thank you for your purchase. Your order has been successfully processed and is being provisioned.</p>
      
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Reference</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};font-variant-numeric:tabular-nums;">${order.reference}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Product</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.productName}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Service</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.service}</td>
      </tr>
      ${order.region ? `<tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Region</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.region}</td>
      </tr>` : ""}
      ${order.duration ? `<tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Duration</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.duration}</td>
      </tr>` : ""}
      <tr>
        <td style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Amount Paid</td>
        <td align="right" style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.4;font-weight:700;color:${config.accentColor};font-variant-numeric:tabular-nums;">₦${order.amount.toLocaleString()}</td>
      </tr></table>
    </td></tr>
  </table>
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${config.siteUrl}/dashboard/orders" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">View Order Details  &#8594;</a>
      </td>
    </tr>
  </table>
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${config.infoBackground};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">Your service is being provisioned. You'll receive your credentials (OTP code, eSIM QR, proxy details) within minutes.</p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `Order Confirmed — ${order.reference}`,
    html: emailWrapper(content, preheader),
    text: `Order Confirmed!\n\nReference: ${order.reference}\nProduct: ${order.productName}\nAmount: ₦${order.amount.toLocaleString()}\n\nView your orders at ${config.siteUrl}/dashboard/orders`,
    preheader,
  };
}

export function walletTopupEmail(amount: number, balance: number, reference: string): EmailTemplate {
  const preheader = `₦${amount.toLocaleString()} has been added to your wallet. Your new balance is ₦${balance.toLocaleString()}.`;

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:${config.primaryColor};background-image:${config.primaryGradient};"> </div>
              <img src="${config.siteUrl}/images/email/hero-wallet.jpg" width="600" alt="Wallet Topped Up" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#4caf50;">Top-up Successful</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">Your wallet has been topped up</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">₦${amount.toLocaleString()} has been added to your wallet. You can now use this balance to purchase any Pryva service.</p>
      
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Amount Added</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.4;font-weight:700;color:#4caf50;font-variant-numeric:tabular-nums;">+₦${amount.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">New Balance</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.4;font-weight:700;color:${config.darkColor};font-variant-numeric:tabular-nums;">₦${balance.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Reference</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};font-variant-numeric:tabular-nums;">${reference}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Date</td>
        <td align="right" style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
      </tr></table>
    </td></tr>
  </table>
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${config.siteUrl}/dashboard" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">Start Shopping  &#8594;</a>
      </td>
    </tr>
  </table>
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${config.infoBackground};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">Your balance is valid for 90 days from your last activity. Use it for virtual numbers, eSIMs, proxies, and digital accounts.</p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `Wallet topped up — ₦${amount.toLocaleString()}`,
    html: emailWrapper(content, preheader),
    text: `Wallet Topped Up!\n\nAmount: +₦${amount.toLocaleString()}\nNew Balance: ₦${balance.toLocaleString()}\nReference: ${reference}`,
    preheader,
  };
}

export function giftCardEmail(gift: { 
  code: string; 
  amount: number; 
  senderName: string; 
  message?: string;
}): EmailTemplate {
  const preheader = `${gift.senderName} sent you a ₦${gift.amount.toLocaleString()} Pryva gift card. Redeem it now!`;

  const messageSection = gift.message ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:16px 18px;">
      <p style="margin:0 0 8px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;font-weight:600;color:${config.textSecondary};">Message from ${gift.senderName}:</p>
      <p style="margin:0;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;color:${config.textColor};font-style:italic;">"${gift.message}"</p>
    </td></tr>
  </table>
  ` : "";

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:#e91e63;background-image:linear-gradient(90deg,#e91e63,#f06292);"> </div>
              <img src="${config.siteUrl}/images/email/hero-gift.jpg" width="600" alt="Gift Card" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#e91e63;">Gift Card</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">You received a gift card!</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">${gift.senderName} sent you a Pryva gift card worth ₦${gift.amount.toLocaleString()}. Redeem it to add credit to your wallet.</p>
      
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:linear-gradient(135deg,${config.infoBackground} 0%,#e8e3f5 100%);border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:24px 18px;text-align:center;">
      <p style="margin:0 0 8px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;font-weight:500;color:${config.textSecondary};">Gift Card Value</p>
      <p style="margin:0 0 16px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:42px;font-weight:700;color:${config.accentColor};">₦${gift.amount.toLocaleString()}</p>
      <div style="height:1px;background:${config.cardBorder};margin:16px 0;"></div>
      <p style="margin:0 0 8px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:600;color:${config.textSecondary};text-transform:uppercase;letter-spacing:1px;">Your Code</p>
      <p style="margin:0;font-family:monospace;font-size:20px;font-weight:700;color:${config.darkColor};letter-spacing:2px;">${gift.code}</p>
    </td></tr>
  </table>
      
      ${messageSection}
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${config.siteUrl}/dashboard/gift-cards" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">Redeem Now  &#8594;</a>
      </td>
    </tr>
  </table>
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${config.infoBackground};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">Use this gift card to add credit to your Pryva wallet. Valid for virtual numbers, eSIMs, proxies, and digital accounts.</p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `${gift.senderName} sent you a Pryva gift card! 🎁`,
    html: emailWrapper(content, preheader),
    text: `You received a Pryva gift card!\n\nFrom: ${gift.senderName}\nAmount: ₦${gift.amount.toLocaleString()}\nCode: ${gift.code}\n\nRedeem at ${config.siteUrl}/dashboard/gift-cards`,
    preheader,
  };
}

export function refundEmail(order: { reference: string; productName: string; amount: number; reason: string }): EmailTemplate {
  const preheader = `₦${order.amount.toLocaleString()} has been refunded to your wallet for order ${order.reference}.`;

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:#ff9800;background-image:linear-gradient(90deg,#ff9800,#ffa726);"> </div>
              <img src="${config.siteUrl}/images/email/hero-refund.jpg" width="600" alt="Refund Processed" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#ff9800;">Refund Processed</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">We've processed your refund</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">₦${order.amount.toLocaleString()} has been credited back to your wallet and is available for immediate use.</p>
      
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${config.infoBackground};border:1px solid ${config.infoBorder};border-radius:12px;">
    <tr><td style="padding:4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Order Reference</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};font-variant-numeric:tabular-nums;">${order.reference}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Product</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.productName}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Refund Amount</td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${config.cardBorder};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.4;font-weight:700;color:#4caf50;font-variant-numeric:tabular-nums;">+₦${order.amount.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12.5px;line-height:1.4;font-weight:500;color:${config.textSecondary};">Reason</td>
        <td align="right" style="padding:11px 0;border-bottom:none;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:13.5px;line-height:1.4;font-weight:600;color:${config.darkColor};">${order.reason}</td>
      </tr></table>
    </td></tr>
  </table>
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${config.siteUrl}/dashboard/wallet" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">Check Wallet  &#8594;</a>
      </td>
    </tr>
  </table>
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${config.infoBackground};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">The refund has been added to your wallet balance and is available for immediate use on any Pryva service.</p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `Refund Processed — ${order.reference}`,
    html: emailWrapper(content, preheader),
    text: `Refund Processed\n\n₦${order.amount.toLocaleString()} has been credited to your wallet.\nReason: ${order.reason}`,
    preheader,
  };
}

export function passwordResetEmail(name: string, resetLink: string): EmailTemplate {
  const preheader = "Reset your Pryva password. This link expires in 1 hour.";

  const content = `
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;" class="email-container">
          <tr>
            <td style="background-color:${config.cardBackground};border:1px solid ${config.cardBorder};border-radius:18px;overflow:hidden;">
              <div style="height:5px;line-height:5px;font-size:0;background-color:${config.darkColor};background-image:linear-gradient(90deg,${config.darkColor},#4a4359);"> </div>
              <img src="${config.siteUrl}/images/email/hero-password.jpg" width="600" alt="Password Reset" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
              <div style="padding:32px 36px 30px;" class="email-padding">
      <div style="margin:0 0 12px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${config.darkColor};">Security</div>
      <h1 style="margin:0 0 14px;font-family:'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${config.darkColor};">Reset your password</h1>
      <p style="margin:0 0 14px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:15px;line-height:1.65;font-weight:400;color:${config.textColor};text-align:left;">Hi ${name}, we received a request to reset your password. Click the button below to create a new password.</p>
      
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${config.darkColor}" style="border-radius:12px;">
        <a href="${resetLink}" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${config.darkColor};font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;white-space:nowrap;">Reset Password  &#8594;</a>
      </td>
    </tr>
  </table>
      
      <p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:#fff3e0;border:1px solid #ffe0b2;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:#e65100;">
        <strong>⚠️ Security Notice:</strong> This link expires in 1 hour. If you didn't request this, please ignore this email or contact support if you're concerned about your account security.
      </p>
      
      <p style="margin:18px 0 2px;font-family:'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:${config.textSecondary};">If the button doesn't work, copy and paste this link:<br><a href="${resetLink}" style="color:${config.accentColor};word-break:break-all;">${resetLink}</a></p>
    </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return {
    subject: `Reset your Pryva password`,
    html: emailWrapper(content, preheader),
    text: `Reset your Pryva password\n\nClick this link to reset your password: ${resetLink}\n\nThis link expires in 1 hour.`,
    preheader,
  };
}
