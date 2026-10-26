export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

const baseStyles = `
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .header { background: linear-gradient(135deg, #8266C9 0%, #B49CE7 100%); padding: 40px 30px; text-align: center; }
  .logo { color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; }
  .content { padding: 40px 30px; }
  .footer { background: #f8f7fc; padding: 30px; text-align: center; font-size: 13px; color: #6b5f74; }
  .button { display: inline-block; background: linear-gradient(135deg, #8266C9 0%, #B49CE7 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 999px; font-weight: 600; font-size: 15px; margin: 20px 0; }
  .button:hover { opacity: 0.9; }
  h1 { color: #29223a; font-size: 28px; font-weight: 700; margin: 0 0 16px 0; }
  h2 { color: #29223a; font-size: 22px; font-weight: 600; margin: 0 0 12px 0; }
  p { color: #4a4359; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0; }
  .info-box { background: #f8f7fc; border-left: 4px solid #8266C9; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .success-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .warning-box { background: #fff3e0; border-left: 4px solid #ff9800; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .order-details { background: #f8f7fc; padding: 20px; border-radius: 12px; margin: 20px 0; }
  .order-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e7e0ee; }
  .order-row:last-child { border-bottom: none; }
  .order-label { color: #6b5f74; font-size: 14px; }
  .order-value { color: #29223a; font-size: 14px; font-weight: 600; }
  .highlight { color: #8266C9; font-weight: 600; }
  .divider { height: 1px; background: #e7e0ee; margin: 30px 0; }
`;

export function welcomeEmail(name: string, bonusAmount?: number): EmailTemplate {
  const bonusSection = bonusAmount 
    ? `<div class="success-box">
        <p style="margin: 0;"><strong>🎉 Welcome Bonus:</strong> We've added <span class="highlight">₦${bonusAmount.toLocaleString()}</span> to your wallet!</p>
       </div>`
    : '';

  return {
    subject: `Welcome to Pryva, ${name}! 🎉`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Pryva</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Simple. Secure. Scalable.</p>
          </div>
          
          <div class="content">
            <h1>Welcome aboard, ${name}! 👋</h1>
            <p>Thank you for joining Pryva. We're thrilled to have you as part of our community of digital nomads, developers, and privacy-conscious users.</p>
            
            ${bonusSection}
            
            <h2>What you can do with Pryva:</h2>
            <div class="info-box">
              <p style="margin: 0 0 12px 0;"><strong>📱 Virtual Numbers</strong> — Get OTP codes from 40+ countries instantly</p>
              <p style="margin: 0 0 12px 0;"><strong>🌍 eSIM Data</strong> — Stay connected in 190+ destinations</p>
              <p style="margin: 0 0 12px 0;"><strong>🔒 Residential Proxies</strong> — Access geo-restricted content</p>
              <p style="margin: 0 0 12px 0;"><strong>📧 Email OTP</strong> — Temporary email for verification</p>
              <p style="margin: 0;"><strong>🎬 Digital Accounts</strong> — Netflix, Spotify, and more</p>
            </div>
            
            <p>Get started by topping up your wallet and making your first purchase. All payments are in Naira — no dollar card needed!</p>
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard" class="button">Go to Dashboard →</a>
            </div>
            
            <div class="divider"></div>
            
            <p style="font-size: 13px; color: #6b5f74;">Need help? Reply to this email or visit our <a href="https://pryva.ng/help" style="color: #8266C9;">Help Center</a>.</p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
            <p style="margin: 8px 0 0 0;">Lagos, Nigeria</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Welcome to Pryva, ${name}!\n\nThank you for joining Pryva. Get started by visiting your dashboard at https://pryva.ng/dashboard`,
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
  return {
    subject: `Order Confirmed — ${order.reference}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Order Confirmation</p>
          </div>
          
          <div class="content">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
              <h1 style="margin: 0;">Order Confirmed!</h1>
              <p style="color: #6b5f74;">Your order has been successfully processed</p>
            </div>
            
            <div class="order-details">
              <h2 style="margin-top: 0;">Order Details</h2>
              <div class="order-row">
                <span class="order-label">Reference</span>
                <span class="order-value">${order.reference}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Product</span>
                <span class="order-value">${order.productName}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Service</span>
                <span class="order-value">${order.service}</span>
              </div>
              ${order.region ? `<div class="order-row">
                <span class="order-label">Region</span>
                <span class="order-value">${order.region}</span>
              </div>` : ''}
              ${order.duration ? `<div class="order-row">
                <span class="order-label">Duration</span>
                <span class="order-value">${order.duration}</span>
              </div>` : ''}
              <div class="order-row">
                <span class="order-label">Amount Paid</span>
                <span class="order-value" style="color: #8266C9; font-size: 16px;">₦${order.amount.toLocaleString()}</span>
              </div>
            </div>
            
            <div class="info-box">
              <p style="margin: 0;"><strong>What's next?</strong> Your service is being provisioned. You'll receive your credentials (OTP code, eSIM QR, proxy details) within minutes.</p>
            </div>
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard/orders" class="button">View Order Details →</a>
            </div>
            
            <div class="divider"></div>
            
            <p style="font-size: 13px; color: #6b5f74;">Questions? Reply to this email or contact <a href="mailto:support@pryva.ng" style="color: #8266C9;">support@pryva.ng</a></p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Order Confirmed!\n\nReference: ${order.reference}\nProduct: ${order.productName}\nAmount: ₦${order.amount.toLocaleString()}\n\nView your orders at https://pryva.ng/dashboard/orders`,
  };
}

export function orderDeliveredEmail(order: {
  reference: string;
  productName: string;
  service: string;
  credentials?: string;
  expiresAt?: Date;
}): EmailTemplate {
  return {
    subject: `Your ${order.productName} is ready! 🎉`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Delivered</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header" style="background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Order Delivered</p>
          </div>
          
          <div class="content">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
              <h1 style="margin: 0;">Your order is ready!</h1>
              <p style="color: #6b5f74;">${order.productName} has been delivered</p>
            </div>
            
            <div class="success-box">
              <p style="margin: 0 0 12px 0;"><strong>Service:</strong> ${order.service}</p>
              <p style="margin: 0 0 12px 0;"><strong>Product:</strong> ${order.productName}</p>
              ${order.expiresAt ? `<p style="margin: 0;"><strong>Expires:</strong> ${new Date(order.expiresAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</p>` : ''}
            </div>
            
            ${order.credentials ? `
            <div class="order-details">
              <h2 style="margin-top: 0;">Your Credentials</h2>
              <div style="background: #ffffff; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 14px; word-break: break-all;">
                ${order.credentials}
              </div>
              <p style="font-size: 13px; color: #6b5f74; margin: 12px 0 0 0;">⚠️ Save these credentials securely. They won't be shown again.</p>
            </div>
            ` : ''}
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard/orders" class="button">View in Dashboard →</a>
            </div>
            
            <div class="divider"></div>
            
            <p style="font-size: 13px; color: #6b5f74;">Having issues? Reply to this email for instant support.</p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Your order is ready!\n\n${order.productName} has been delivered.\n\nView in dashboard: https://pryva.ng/dashboard/orders`,
  };
}

export function refundEmail(order: { reference: string; productName: string; amount: number; reason: string }): EmailTemplate {
  return {
    subject: `Refund Processed — ${order.reference}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Refund Processed</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header" style="background: linear-gradient(135deg, #ff9800 0%, #ffa726 100%);">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Refund Processed</p>
          </div>
          
          <div class="content">
            <h1>Refund Processed</h1>
            <p>We've processed a refund for your order. The amount has been credited back to your wallet.</p>
            
            <div class="order-details">
              <div class="order-row">
                <span class="order-label">Order Reference</span>
                <span class="order-value">${order.reference}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Product</span>
                <span class="order-value">${order.productName}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Refund Amount</span>
                <span class="order-value" style="color: #4caf50; font-size: 16px;">+₦${order.amount.toLocaleString()}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Reason</span>
                <span class="order-value">${order.reason}</span>
              </div>
            </div>
            
            <div class="info-box">
              <p style="margin: 0;">💰 The refund has been added to your wallet balance and is available for immediate use.</p>
            </div>
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard/wallet" class="button">Check Wallet →</a>
            </div>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Refund Processed\n\n₦${order.amount.toLocaleString()} has been credited to your wallet.\nReason: ${order.reason}`,
  };
}

export function giftCardEmail(gift: { 
  code: string; 
  amount: number; 
  senderName: string; 
  message?: string;
}): EmailTemplate {
  return {
    subject: `${gift.senderName} sent you a Pryva gift card! 🎁`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gift Card</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header" style="background: linear-gradient(135deg, #e91e63 0%, #f06292 100%);">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">You received a gift!</p>
          </div>
          
          <div class="content">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="font-size: 64px; margin-bottom: 16px;">🎁</div>
              <h1 style="margin: 0;">You got a gift card!</h1>
              <p style="color: #6b5f74; font-size: 18px;">From <strong>${gift.senderName}</strong></p>
            </div>
            
            <div style="background: linear-gradient(135deg, #f8f7fc 0%, #e8e3f5 100%); padding: 30px; border-radius: 16px; text-align: center; margin: 30px 0;">
              <p style="color: #6b5f74; font-size: 14px; margin: 0 0 8px 0;">Gift Card Value</p>
              <p style="color: #8266C9; font-size: 48px; font-weight: 700; margin: 0;">₦${gift.amount.toLocaleString()}</p>
              <div class="divider" style="margin: 20px 0;"></div>
              <p style="color: #6b5f74; font-size: 12px; margin: 0 0 8px 0;">Your Code</p>
              <p style="font-family: monospace; font-size: 24px; font-weight: 600; color: #29223a; margin: 0; letter-spacing: 2px;">${gift.code}</p>
            </div>
            
            ${gift.message ? `
            <div class="info-box">
              <p style="margin: 0;"><strong>Message from ${gift.senderName}:</strong></p>
              <p style="margin: 8px 0 0 0; font-style: italic;">"${gift.message}"</p>
            </div>
            ` : ''}
            
            <p>Redeem this gift card to add credit to your Pryva wallet. Use it for virtual numbers, eSIMs, proxies, and more!</p>
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard/gift-cards" class="button">Redeem Now →</a>
            </div>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `You received a Pryva gift card!\n\nFrom: ${gift.senderName}\nAmount: ₦${gift.amount.toLocaleString()}\nCode: ${gift.code}\n\nRedeem at https://pryva.ng/dashboard/gift-cards`,
  };
}

export function walletTopupEmail(amount: number, balance: number, reference: string): EmailTemplate {
  return {
    subject: `Wallet topped up — ₦${amount.toLocaleString()}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Wallet Top-up</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Wallet Top-up</p>
          </div>
          
          <div class="content">
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="font-size: 48px; margin-bottom: 16px;">💰</div>
              <h1 style="margin: 0;">Wallet Topped Up!</h1>
            </div>
            
            <div style="background: linear-gradient(135deg, #f8f7fc 0%, #e8e3f5 100%); padding: 30px; border-radius: 16px; text-align: center; margin: 30px 0;">
              <p style="color: #6b5f74; font-size: 14px; margin: 0 0 8px 0;">Amount Added</p>
              <p style="color: #4caf50; font-size: 48px; font-weight: 700; margin: 0;">+₦${amount.toLocaleString()}</p>
              <div class="divider" style="margin: 20px 0;"></div>
              <p style="color: #6b5f74; font-size: 14px; margin: 0 0 8px 0;">New Balance</p>
              <p style="color: #29223a; font-size: 32px; font-weight: 700; margin: 0;">₦${balance.toLocaleString()}</p>
            </div>
            
            <div class="order-details">
              <div class="order-row">
                <span class="order-label">Reference</span>
                <span class="order-value">${reference}</span>
              </div>
              <div class="order-row">
                <span class="order-label">Date</span>
                <span class="order-value">${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            </div>
            
            <div style="text-align: center;">
              <a href="https://pryva.ng/dashboard" class="button">Start Shopping →</a>
            </div>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Wallet Topped Up!\n\nAmount: +₦${amount.toLocaleString()}\nNew Balance: ₦${balance.toLocaleString()}\nReference: ${reference}`,
  };
}

export function passwordResetEmail(name: string, resetLink: string): EmailTemplate {
  return {
    subject: `Reset your Pryva password`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>${baseStyles}</style>
      </head>
      <body style="background: #f5f3fa; padding: 20px;">
        <div class="container">
          <div class="header" style="background: linear-gradient(135deg, #29223a 0%, #4a4359 100%);">
            <div class="logo">Pryva</div>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 8px 0 0 0;">Password Reset</p>
          </div>
          
          <div class="content">
            <h1>Hi ${name},</h1>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password →</a>
            </div>
            
            <div class="warning-box">
              <p style="margin: 0;"><strong>⚠️ Security Notice:</strong> This link expires in 1 hour. If you didn't request this, please ignore this email or contact support if you're concerned about your account security.</p>
            </div>
            
            <p style="font-size: 13px; color: #6b5f74;">If the button doesn't work, copy and paste this link:<br><a href="${resetLink}" style="color: #8266C9; word-break: break-all;">${resetLink}</a></p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">© 2024 Pryva. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Reset your Pryva password\n\nClick this link to reset your password: ${resetLink}\n\nThis link expires in 1 hour.`,
  };
}
