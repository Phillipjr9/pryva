import type { DataPlan } from "@/lib/airtime";
import type { Plan } from "@/lib/catalog";
import type { ExplorerCountry } from "@/lib/explorer-countries";
import type { ExplorerItem } from "@/lib/service-explorer";

/** Presentation is derived from the same validated selection used for checkout. */
export type DemoServicePresentation = {
  category: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
  deliveryTitle: string;
  deliveryDescription: string;
  checkoutSummary: string;
  checkoutDelivery: string;
};

const NETWORK_NAMES: Record<DataPlan["provider"], string> = { mtn: "MTN", airtel: "Airtel", glo: "Glo", "9mobile": "9mobile" };

type Selection = {
  item: ExplorerItem;
  country: ExplorerCountry;
  terms: { units: number };
  plan?: Plan;
  dataPlan?: DataPlan;
};

/**
 * Describe only what the in-memory demo actually does. In particular, region
 * labels are examples, not a claim that a supplier covers the chosen country.
 */
export function demoServicePresentation({ item, country, terms, plan, dataPlan }: Selection): DemoServicePresentation | null {
  const selectedCountry = { label: "Selected country", value: country.name };

  if (item.category === "verification" && item.platform) {
    return {
      category: "App verification",
      description: `Preview an SMS verification for ${item.platform} using a fictional number and code.`,
      facts: [
        { label: "App", value: item.platform }, selectedCountry,
        { label: "Includes", value: "1 demo verification" }, { label: "Window", value: "20 minutes" },
      ],
      deliveryTitle: "A demo number and code",
      deliveryDescription: "Your order will show a fictional number, followed by an animated demo code. Neither works with the real app.",
      checkoutSummary: "1 demo verification",
      checkoutDelivery: "Watch the simulated SMS code arrive in your order.",
    };
  }

  if (item.category === "social" && item.platform) {
    const quantity = `${terms.units.toLocaleString("en-US")} demo ${item.tag.toLowerCase()}`;
    return {
      category: "Social promotion",
      description: `Preview ${item.tag.toLowerCase()} for ${item.platform} with a fictional campaign.`,
      facts: [
        { label: "Platform", value: item.platform }, { label: "Promotion", value: item.tag },
        { label: "Package", value: quantity }, { label: "Target", value: "Fictional demo profile" }, selectedCountry,
      ],
      deliveryTitle: "A simulated campaign",
      deliveryDescription: "Follow a short progress animation in your order. No profile is contacted and no real engagement is delivered.",
      checkoutSummary: quantity,
      checkoutDelivery: "Watch this fictional promotion complete in your order.",
    };
  }

  if (item.category === "numbers" && plan?.service === "numbers") {
    const rental = plan.slug.startsWith("rent-");
    const quantity = rental ? "1 demo rental" : `${terms.units} demo verification${terms.units === 1 ? "" : "s"}`;
    return {
      category: "Number plans",
      description: rental ? "Preview a reusable number rental with a fictional number." : "Preview verification with fictional numbers and codes.",
      facts: [
        { label: "Plan", value: plan.planLabel }, selectedCountry,
        { label: "Duration", value: plan.duration }, { label: "Includes", value: quantity },
      ],
      deliveryTitle: rental ? "A reusable demo number" : "A demo number and code",
      deliveryDescription: rental
        ? "Use the same fictional number to simulate more codes while the demo rental is active."
        : terms.units > 1
          ? "Your order starts with one fictional number and code; use each remaining demo unit to simulate another."
          : "Your order will show a fictional number, followed by an animated demo code.",
      checkoutSummary: quantity,
      checkoutDelivery: rental ? "Simulate multiple codes on the same demo number." : "Watch the simulated code arrive in your order.",
    };
  }

  if (item.category === "email" && plan?.service === "email-otp") {
    const quantity = `${terms.units} demo inbox${terms.units === 1 ? "" : "es"}`;
    return {
      category: "Email OTP",
      description: "Preview temporary inboxes and email codes without sending or receiving real email.",
      facts: [
        { label: "Plan", value: plan.planLabel }, { label: "Duration", value: plan.duration },
        { label: "Includes", value: quantity }, { label: "Country", value: "Not country-specific" },
      ],
      deliveryTitle: "A demo inbox and code",
      deliveryDescription: terms.units > 1
        ? "Your order starts with one fictional inbox and code. Use each remaining demo unit to create the next inbox and code."
        : "Your order will show a fictional inbox and one animated demo code.",
      checkoutSummary: quantity,
      checkoutDelivery: "See a fictional inbox and code in your order.",
    };
  }

  if (item.category === "esim" && plan?.service === "esim") {
    return {
      category: "eSIM",
      description: "Preview the activation details for this eSIM plan.",
      facts: [
        { label: "Plan", value: plan.planLabel }, { label: "Catalog region", value: plan.region },
        selectedCountry, { label: "Duration", value: plan.duration },
      ],
      deliveryTitle: "Demo activation details",
      deliveryDescription: "Your order will show a fictional activation code and matching ID. It cannot activate a device or provide data.",
      checkoutSummary: `1 demo eSIM · ${plan.planLabel}`,
      checkoutDelivery: "View fictional activation details in your order.",
    };
  }

  if (item.category === "proxies" && plan?.service === "proxies") {
    return {
      category: "Proxies",
      description: "Preview the connection details for this proxy plan.",
      facts: [
        { label: "Plan", value: plan.planLabel }, { label: "Catalog region", value: plan.region },
        selectedCountry, { label: "Duration", value: plan.duration },
      ],
      deliveryTitle: "Demo proxy credentials",
      deliveryDescription: "Your order will show a fictional host and credentials. They cannot be used as a real proxy connection.",
      checkoutSummary: `1 demo proxy plan · ${plan.planLabel}`,
      checkoutDelivery: "View fictional connection details in your order.",
    };
  }

  if (item.category === "data" && dataPlan) {
    return {
      category: "Mobile data",
      description: `Preview a ${dataPlan.name} mobile data top-up.`,
      facts: [
        { label: "Network", value: NETWORK_NAMES[dataPlan.provider] },
        { label: "Data", value: dataPlan.size }, { label: "Duration", value: dataPlan.duration },
        selectedCountry, { label: "Destination", value: "Fictional demo mobile" },
      ],
      deliveryTitle: "A simulated top-up",
      deliveryDescription: "The order uses a fictional mobile destination. No phone number is needed and no data is sent.",
      checkoutSummary: `1 demo data plan · ${dataPlan.size}`,
      checkoutDelivery: "See the simulated top-up in your order.",
    };
  }

  // A new catalog category must provide an explicit demo experience first.
  return null;
}
