export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export function welcomeEmail(name: string): EmailTemplate {
  return {
    subject: "Welcome to Pryva!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #8266c9;">Welcome to Pryva, ${name}!</h1>
        <p>Thank you for joining Pryva. We're excited to have you on board.</p>
        <p>With Pryva, you can:</p>
        <ul>
          <li>Buy virtual numbers from 40+ countries</li>
          <li>Get eSIM data for 190+ destinations</li>
          <li>Access residential proxies</li>
          <li>Use email OTP services</li>
        </ul>
        <p>Get started by topping up your wallet and making your first purchase.</p>
        <a href="https://pryva.ng/dashboard" style="display: inline-block; background: #8266c9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Go to Dashboard</a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">If you have any questions, reply to this email or visit our help center.</p>
      </div>
    `,
    text: `Welcome to Pryva, ${name}!\n\nThank you for joining Pryva. Get started by visiting your dashboard at https://pryva.ng/dashboard`,
  };
}

export function orderConfirmationEmail(order: { reference: string; productName: string; amount: number }): EmailTemplate {
  return {
    subject: `Order Confirmation - ${order.reference}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #8266c9;">Order Confirmed!</h1>
        <p>Your order has been successfully processed.</p>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Reference:</strong> ${order.reference}</p>
          <p><strong>Product:</strong> ${order.productName}</p>
          <p><strong>Amount:</strong> ₦${order.amount.toLocaleString()}</p>
        </div>
        <p>You can view your order details and access your service in your dashboard.</p>
        <a href="https://pryva.ng/dashboard/orders" style="display: inline-block; background: #8266c9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">View Orders</a>
      </div>
    `,
    text: `Order Confirmed!\n\nReference: ${order.reference}\nProduct: ${order.productName}\nAmount: ₦${order.amount.toLocaleString()}\n\nView your orders at https://pryva.ng/dashboard/orders`,
  };
}

export function refundEmail(order: { reference: string; productName: string; amount: number; reason: string }): EmailTemplate {
  return {
    subject: `Refund Processed - ${order.reference}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #8266c9;">Refund Processed</h1>
        <p>A refund has been processed for your order.</p>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Reference:</strong> ${order.reference}</p>
          <p><strong>Product:</strong> ${order.productName}</p>
          <p><strong>Amount:</strong> ₦${order.amount.toLocaleString()}</p>
          <p><strong>Reason:</strong> ${order.reason}</p>
        </div>
        <p>The refund has been credited to your wallet and is available for immediate use.</p>
        <a href="https://pryva.ng/dashboard/wallet" style="display: inline-block; background: #8266c9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">View Wallet</a>
      </div>
    `,
    text: `Refund Processed\n\nReference: ${order.reference}\nProduct: ${order.productName}\nAmount: ₦${order.amount.toLocaleString()}\nReason: ${order.reason}\n\nView your wallet at https://pryva.ng/dashboard/wallet`,
  };
}

export function giftCardEmail(code: string, amount: number, message?: string): EmailTemplate {
  return {
    subject: "You've received a Pryva gift card!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #8266c9;">You've received a gift card!</h1>
        <p>Someone sent you a Pryva gift card worth ₦${amount.toLocaleString()}.</p>
        ${message ? `<p style="font-style: italic; color: #666;">"${message}"</p>` : ""}
        <div style="background: #f5f5f5; padding: 24px; border-radius: 8px; margin: 16px 0; text-align: center;">
          <p style="font-size: 14px; color: #666; margin: 0;">Your gift card code:</p>
          <p style="font-size: 24px; font-weight: bold; color: #8266c9; margin: 8px 0;">${code}</p>
          <p style="font-size: 18px; font-weight: bold; margin: 0;">₦${amount.toLocaleString()}</p>
        </div>
        <p>To redeem this gift card, sign in to your Pryva account and enter the code in the gift cards section.</p>
        <a href="https://pryva.ng/dashboard/gift-cards" style="display: inline-block; background: #8266c9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Redeem Now</a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">This gift card is valid for 12 months from the date of purchase.</p>
      </div>
    `,
    text: `You've received a Pryva gift card!\n\nCode: ${code}\nAmount: ₦${amount.toLocaleString()}\n${message ? `Message: ${message}\n\n` : ""}Redeem at https://pryva.ng/dashboard/gift-cards`,
  };
}
