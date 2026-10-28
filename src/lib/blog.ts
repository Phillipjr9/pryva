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
      { heading: "If delivery is uncertain", paragraphs: ["Keep the order reference and contact support. Do not place the same order again until its status is clear. Live virtual-number fulfillment is currently paused; preview numbers and balances are simulated."] },
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
      { heading: "Availability", paragraphs: ["Live eSIM fulfillment is currently paused. A preview order is simulated and does not provide a working data plan. Contact support about an existing order."] },
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
      { heading: "Availability", paragraphs: ["Live proxy fulfillment is currently paused. Preview credentials are simulated and do not provide network access."] },
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
      { heading: "Need help?", paragraphs: ["If an order is uncertain, keep its reference and contact support before ordering again. Live number fulfillment is currently paused; preview orders are simulated."] },
    ],
  },
  {
    slug: "gift-cards-for-teams",
    title: "Using Gift Cards for Team Rewards",
    excerpt: "Considerations for issuing and protecting wallet gift-card codes.",
    category: "Business",
    sections: [
      { heading: "Before purchasing", paragraphs: ["Choose the amount and intended recipient carefully, and review the terms and expiry displayed at checkout. Gift cards are non-refundable once purchased. A preview gift card represents simulated credit, not real money."] },
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
      { heading: "Availability", paragraphs: ["Live bulk fulfillment is currently paused. The preview is a simulation and does not issue real products."] },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}
