/**
 * Digital Accounts & Subscriptions
 * Netflix, Spotify, and other digital service accounts
 */

import { DIGITAL_PRICES } from "@/lib/prices.generated";

export type DigitalServiceCategory = "streaming" | "music" | "gaming" | "productivity" | "other";

export interface DigitalService {
  slug: string;
  name: string;
  category: DigitalServiceCategory;
  description: string;
  icon: string;
  plans: DigitalPlan[];
}

export interface DigitalPlan {
  id: string;
  name: string;
  duration: string;
  /** Generated from the supplier cost sheet — see scripts/build-prices.mjs. */
  price: number;
  compareAt?: number;
  features: string[];
  popular?: boolean;
  badge?: string;
}

type DigitalServiceDefinition = Omit<DigitalService, "plans"> & {
  plans: Omit<DigitalPlan, "price">[];
};

const digitalServiceDefinitions: DigitalServiceDefinition[] = [
  {
    slug: "netflix",
    name: "Netflix",
    category: "streaming",
    description: "Premium Netflix accounts with full access to all content",
    icon: "🎬",
    plans: [
      {
        id: "netflix-1month",
        name: "Netflix Premium - 1 Month",
        duration: "30 days",
        compareAt: 6500,
        features: [
          "4K Ultra HD streaming",
          "Watch on 4 devices simultaneously",
          "Full content library access",
          "Download for offline viewing",
        ],
        popular: true,
        badge: "Best Value",
      },
      {
        id: "netflix-3months",
        name: "Netflix Premium - 3 Months",
        duration: "90 days",
        compareAt: 19500,
        features: [
          "4K Ultra HD streaming",
          "Watch on 4 devices simultaneously",
          "Full content library access",
          "Download for offline viewing",
          "Save 51% vs monthly",
        ],
      },
      {
        id: "netflix-6months",
        name: "Netflix Premium - 6 Months",
        duration: "180 days",
        compareAt: 39000,
        features: [
          "4K Ultra HD streaming",
          "Watch on 4 devices simultaneously",
          "Full content library access",
          "Download for offline viewing",
          "Save 55% vs monthly",
        ],
        badge: "Most Popular",
      },
    ],
  },
  {
    slug: "spotify",
    name: "Spotify",
    category: "music",
    description: "Spotify Premium accounts with ad-free music streaming",
    icon: "🎵",
    plans: [
      {
        id: "spotify-1month",
        name: "Spotify Premium - 1 Month",
        duration: "30 days",
        compareAt: 3500,
        features: [
          "Ad-free music streaming",
          "Download songs offline",
          "High quality audio",
          "Unlimited skips",
        ],
        popular: true,
      },
      {
        id: "spotify-3months",
        name: "Spotify Premium - 3 Months",
        duration: "90 days",
        compareAt: 10500,
        features: [
          "Ad-free music streaming",
          "Download songs offline",
          "High quality audio",
          "Unlimited skips",
          "Save 48% vs monthly",
        ],
      },
      {
        id: "spotify-6months",
        name: "Spotify Premium - 6 Months",
        duration: "180 days",
        compareAt: 21000,
        features: [
          "Ad-free music streaming",
          "Download songs offline",
          "High quality audio",
          "Unlimited skips",
          "Save 52% vs monthly",
        ],
        badge: "Best Deal",
      },
    ],
  },
  {
    slug: "youtube",
    name: "YouTube Premium",
    category: "streaming",
    description: "YouTube Premium with ad-free videos and YouTube Music",
    icon: "📺",
    plans: [
      {
        id: "youtube-1month",
        name: "YouTube Premium - 1 Month",
        duration: "30 days",
        compareAt: 4500,
        features: [
          "Ad-free videos",
          "Background play",
          "YouTube Music Premium included",
          "Download videos offline",
        ],
        popular: true,
      },
      {
        id: "youtube-3months",
        name: "YouTube Premium - 3 Months",
        duration: "90 days",
        compareAt: 13500,
        features: [
          "Ad-free videos",
          "Background play",
          "YouTube Music Premium included",
          "Download videos offline",
          "Save 52% vs monthly",
        ],
      },
    ],
  },
  {
    slug: "disney",
    name: "Disney+",
    category: "streaming",
    description: "Disney+ accounts with Marvel, Star Wars, and more",
    icon: "🏰",
    plans: [
      {
        id: "disney-1month",
        name: "Disney+ Premium - 1 Month",
        duration: "30 days",
        compareAt: 5500,
        features: [
          "4K Ultra HD streaming",
          "Watch on 4 devices",
          "Marvel, Star Wars, Pixar content",
          "Download for offline viewing",
        ],
        popular: true,
      },
      {
        id: "disney-3months",
        name: "Disney+ Premium - 3 Months",
        duration: "90 days",
        compareAt: 16500,
        features: [
          "4K Ultra HD streaming",
          "Watch on 4 devices",
          "Marvel, Star Wars, Pixar content",
          "Download for offline viewing",
          "Save 52% vs monthly",
        ],
      },
    ],
  },
  {
    slug: "chatgpt",
    name: "ChatGPT Plus",
    category: "productivity",
    description: "ChatGPT Plus accounts with GPT-4 access",
    icon: "🤖",
    plans: [
      {
        id: "chatgpt-1month",
        name: "ChatGPT Plus - 1 Month",
        duration: "30 days",
        compareAt: 15000,
        features: [
          "GPT-4 access",
          "Faster response times",
          "Priority access during peak times",
          "Advanced data analysis",
        ],
        popular: true,
        badge: "Hot",
      },
      {
        id: "chatgpt-3months",
        name: "ChatGPT Plus - 3 Months",
        duration: "90 days",
        compareAt: 45000,
        features: [
          "GPT-4 access",
          "Faster response times",
          "Priority access during peak times",
          "Advanced data analysis",
          "Save 51% vs monthly",
        ],
      },
    ],
  },
  {
    slug: "canva",
    name: "Canva Pro",
    category: "productivity",
    description: "Canva Pro accounts with premium design tools",
    icon: "🎨",
    plans: [
      {
        id: "canva-1month",
        name: "Canva Pro - 1 Month",
        duration: "30 days",
        compareAt: 5000,
        features: [
          "100+ million premium assets",
          "Brand Kit",
          "Background remover",
          "Magic Resize",
        ],
        popular: true,
      },
      {
        id: "canva-3months",
        name: "Canva Pro - 3 Months",
        duration: "90 days",
        compareAt: 15000,
        features: [
          "100+ million premium assets",
          "Brand Kit",
          "Background remover",
          "Magic Resize",
          "Save 57% vs monthly",
        ],
      },
    ],
  },
];

/**
 * Same rule as the main catalogue: the price comes from the supplier cost sheet,
 * inside the 30–50% band. Subscriptions sit at the digital target (40%) because
 * they are price-checked against the platforms' own Naira rates.
 */
export const digitalServices: DigitalService[] = digitalServiceDefinitions.map((service) => ({
  ...service,
  plans: service.plans.map((plan) => {
    const generated = DIGITAL_PRICES[plan.id];
    if (!generated) {
      throw new Error(
        `No generated price for "${plan.id}". Add its supplier cost to ` +
          `data/supplier-costs.json and run \`npm run pricing:build\`.`,
      );
    }
    return {
      ...plan,
      price: generated.price,
      compareAt: plan.compareAt && plan.compareAt > generated.price ? plan.compareAt : undefined,
    };
  }),
}));

export function getDigitalService(slug: string): DigitalService | undefined {
  return digitalServices.find((s) => s.slug === slug);
}

export function getDigitalPlan(planId: string): { service: DigitalService; plan: DigitalPlan } | undefined {
  for (const service of digitalServices) {
    const plan = service.plans.find((p) => p.id === planId);
    if (plan) {
      return { service, plan };
    }
  }
  return undefined;
}

export function getDigitalServicesByCategory(category: DigitalServiceCategory): DigitalService[] {
  return digitalServices.filter((s) => s.category === category);
}
