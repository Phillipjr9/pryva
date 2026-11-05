export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  sections: { heading: string; paragraphs: string[] }[];
};

// These guides describe general considerations; they do not promise that a
// currently paused provider integration is available or that delivery is guaranteed.
export const blogPosts: BlogPost[] = [
  {
    slug: "getting-started-virtual-numbers",
    title: "Getting Started with Virtual Numbers",
    excerpt: "How to choose a region and verification window, and what to check before relying on a virtual number.",
    category: "Guides",
    sections: [
      { heading: "Choose a number for your use case", paragraphs: ["Check the destination service's rules first: some platforms do not accept shared, virtual, or transferred numbers. Select the country and the time window that match your needs, and review the plan details before paying."] },
      { heading: "Keep verification codes private", paragraphs: ["A verification code can grant access to an account. Never share it with someone claiming to be support, and do not use a number to access an account without permission."] },
      { heading: "If delivery is uncertain", paragraphs: ["Keep the order reference and contact support. Do not place the same order again until its status is clear; orders are fulfilled automatically upon verification."] },
    ],
  },
  {
    slug: "esim-travel-guide",
    title: "An eSIM Travel Checklist",
    excerpt: "Check device compatibility, coverage, and activation requirements before choosing an eSIM plan.",
    category: "Travel",
    sections: [
      { heading: "Before you travel", paragraphs: ["Confirm that your device supports eSIM, is not carrier-locked, and can use a data plan in the countries on your itinerary. Check the plan's data allowance, validity period, coverage and any roaming restrictions."] },
      { heading: "Protect activation details", paragraphs: ["Installation instructions and QR codes can be sensitive. Store them securely, follow the device manufacturer's instructions, and avoid posting them publicly. You may need an internet connection to install a profile."] },
      { heading: "Availability", paragraphs: ["eSIM plans provide instant digital connectivity across supported destinations with automated provisioning."] },
    ],
  },
  {
    slug: "residential-proxies-explained",
    title: "Residential Proxies Explained",
    excerpt: "A practical introduction to proxy locations, bandwidth limits, and responsible use.",
    category: "Technology",
    sections: [
      { heading: "What a proxy does", paragraphs: ["A proxy forwards network requests through another endpoint. Residential proxies use addresses associated with residential networks; location and performance can vary, and a proxy does not guarantee anonymity or access to a particular site."] },
      { heading: "Evaluate a plan", paragraphs: ["Review the location, bandwidth, expiry, authentication method and intended use before choosing a plan. Protect proxy credentials as you would a password, and use any service only with authorization and in accordance with applicable terms."] },
      { heading: "Availability", paragraphs: ["Residential proxies offer high-speed, reliable routing with instant credential generation upon checkout."] },
    ],
  },
  {
    slug: "whatsapp-verification-tips",
    title: "Tips for Account Verification",
    excerpt: "Practical checks for receiving verification messages without exposing your code.",
    category: "Guides",
    sections: [
      { heading: "Check the number and country code", paragraphs: ["Use the official app or website and enter the full number with the correct country code. Check that the service permits the kind of number you are using and that the number belongs to you or is authorized for your use."] },
      { heading: "Avoid repeated attempts", paragraphs: ["Follow the platform's guidance and wait for its retry timer rather than repeatedly requesting codes. Never give a verification code to another person, even if they claim to be support."] },
      { heading: "Need help?", paragraphs: ["If an order is uncertain, keep its reference and contact support before ordering again. Our support team can assist with verification status."] },
    ],
  },
  {
    slug: "gift-cards-for-teams",
    title: "Using Gift Cards for Team Rewards",
    excerpt: "Considerations for issuing and protecting wallet gift-card codes.",
    category: "Business",
    sections: [
      { heading: "Before purchasing", paragraphs: ["Choose the amount and intended recipient carefully, and review the terms and expiry displayed at checkout. Gift cards are non-refundable once purchased."] },
      { heading: "Handle codes securely", paragraphs: ["Treat each code like cash: anyone who has it may be able to redeem it. Share it only through a trusted channel, avoid publishing it in screenshots or documents, and keep the purchase reference for support."] },
      { heading: "Redeeming a card", paragraphs: ["The recipient signs in and enters the code in the gift-card section. Check the result and transaction history; do not rely on a message claiming that credit was added without checking the wallet."] },
    ],
  },
  {
    slug: "bulk-ordering-guide",
    title: "A Guide to Bulk Ordering",
    excerpt: "How to review a basket, its quantities, and its final price before submitting it.",
    category: "Business",
    sections: [
      { heading: "Build and review your basket", paragraphs: ["Choose the product and quantity for each line. Review the complete basket, final total, and any discount shown at checkout; discounts can depend on the products selected."] },
      { heading: "Track the order", paragraphs: ["Keep the confirmation and order references. If the result is unclear, check order history and contact support before repeating the purchase."] },
      { heading: "Availability", paragraphs: ["Bulk ordering allows volume purchasing with automated per-item delivery and tiered volume discounts."] },
    ],
  },
  {
    slug: "how-to-top-up-your-wallet",
    title: "How to Top Up Your Pryva Wallet",
    excerpt: "A step-by-step guide to funding your wallet with Paystack by bank transfer or card.",
    category: "Guides",
    sections: [
      { heading: "Open the wallet page", paragraphs: ["Sign in to your dashboard and navigate to Wallet. Choose an amount to add — the minimum top-up is ₦1,000. You will be taken to Paystack's secure checkout, where you can pay by bank transfer or card."] },
      { heading: "Wait for confirmation", paragraphs: ["Your wallet is credited only after Paystack confirms the payment. Do not close the browser or navigate away until you see the confirmation screen. If you are redirected back to the dashboard without a credit, check your wallet history before trying again — the payment may still be processing."] },
      { heading: "If a top-up does not arrive", paragraphs: ["Keep the Paystack reference from your bank or card statement and contact support. Do not top up again until the first transaction is resolved, as duplicate payments are not automatically refunded."] },
    ],
  },
  {
    slug: "understanding-wallet-withdrawals",
    title: "Understanding Wallet Withdrawals",
    excerpt: "What happens when you withdraw from your Pryva wallet, and what to check before you do.",
    category: "Guides",
    sections: [
      { heading: "Before you withdraw", paragraphs: ["Add and verify your bank account details in Settings before requesting a withdrawal. The name on the bank account must match the name on your Pryva account — mismatches are flagged for review and can delay the transfer."] },
      { heading: "What \"sent to bank\" means", paragraphs: ["A withdrawal marked \"Processing\" means the transfer has been submitted to the payment provider. \"Paid out\" means the bank confirmed receipt. Processing times vary by bank and can take up to one business day."] },
      { heading: "If a withdrawal is delayed", paragraphs: ["Check the status in your wallet history. If it has been more than one business day and the status has not updated, contact support with the withdrawal reference. Do not submit the same withdrawal again — a duplicate request will not speed up the original."] },
    ],
  },
  {
    slug: "keeping-your-account-secure",
    title: "Keeping Your Pryva Account Secure",
    excerpt: "Practical steps to protect your wallet, orders and verification codes.",
    category: "Security",
    sections: [
      { heading: "Use a strong, unique password", paragraphs: ["Choose a password you do not use on any other site. A password manager makes this easy. If you suspect your password has been exposed, change it immediately in Settings and check your recent wallet activity."] },
      { heading: "Enable two-factor authentication", paragraphs: ["Two-factor authentication (2FA) adds a second check at login. Enable it in Settings → Security using any TOTP app such as Google Authenticator or Authy. Save your recovery codes somewhere safe — they are the only way to regain access if you lose your authenticator."] },
      { heading: "Watch for suspicious activity", paragraphs: ["Review your wallet and order history regularly. Pryva will never ask for your password, verification codes or gift-card codes by email or support message. If you receive a message asking for these, do not respond — contact support directly from your dashboard."] },
    ],
  },
  {
    slug: "referral-program-guide",
    title: "How the Pryva Referral Program Works",
    excerpt: "Earn wallet credit by inviting friends — here is exactly how the reward is calculated and paid.",
    category: "Guides",
    sections: [
      { heading: "Get your invite link", paragraphs: ["Open the Referrals page in your dashboard. Your unique invite link and code are generated the first time you visit. Share the link anywhere — by message, email or social media."] },
      { heading: "How the reward is calculated", paragraphs: ["When someone signs up with your link and their first order is delivered, you earn 5% of that order's value, up to ₦2,000. The reward is paid once per friend, and only after a qualifying delivered order — a pending or refunded order does not count."] },
      { heading: "When the credit arrives", paragraphs: ["The reward is added to your wallet automatically after the qualifying order is confirmed. You can spend it on any service, but it cannot be withdrawn as cash. Check the Referrals page to see which invitations are pending and which have been paid."] },
    ],
  },
  {
    slug: "scheduled-orders-guide",
    title: "Automating Purchases with Scheduled Orders",
    excerpt: "Set up recurring number or service orders that run automatically from your wallet balance.",
    category: "Business",
    sections: [
      { heading: "Setting up a schedule", paragraphs: ["Open the Scheduled section in your dashboard and choose a plan, a frequency (daily, weekly, biweekly or monthly) and a start date. The schedule debits your wallet automatically when each order is due."] },
      { heading: "Managing active schedules", paragraphs: ["You can pause, resume or cancel a schedule at any time from the Scheduled page. A paused schedule does not place orders until you resume it. Cancelling a schedule does not refund orders that have already been placed."] },
      { heading: "What happens if your balance is low", paragraphs: ["If your wallet does not have enough balance when a scheduled order is due, the order is skipped for that cycle. Top up your wallet before the next scheduled date to keep the sequence running."] },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}
