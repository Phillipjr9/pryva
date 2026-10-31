/**
 * Is boosting ready to take money?
 *
 * Turning it on needs three server settings and one human action, and none of
 * them is visible from the storefront: a panel that was never configured renders
 * exactly like a panel whose catalogue came back empty, and a panel that is
 * configured but unpriced renders as a beautiful list nobody can buy from. This
 * module turns those facts into an ordered checklist an operator can act on, so
 * switching boosting on is a two-minute job rather than an experiment.
 *
 * Pure by design — everything is passed in — because the interesting cases
 * (endpoint set but pointing somewhere it must not, a USD panel with no rate)
 * are exactly the ones that are hard to reproduce by changing real environment
 * variables.
 */

export type StepState = "done" | "todo" | "optional" | "blocked";

export type ReadinessStep = {
  id: "key" | "endpoint" | "margin" | "fx" | "live";
  label: string;
  state: StepState;
  detail: string;
  /** The variable an operator would set. Never a value. */
  env?: string;
};

export type BoostingReadiness = {
  /** Both the key and a usable endpoint: the panel *could* be called. */
  configured: boolean;
  /** Host only, so the screen shows where requests go without echoing a path. */
  endpointHost: string | null;
  markupPercent: number;
  fxRate: number | null;
  steps: ReadinessStep[];
  /** Everything except the human steps: priced listings can exist. */
  readyForPricing: boolean;
};

const MAX_MARKUP = 400;

export function boostingReadiness(input: {
  keySet: boolean;
  endpoint: string | null;
  /** A reason the endpoint was rejected, when it was. */
  endpointProblem?: string | null;
  markupPercent: number;
  fxRate: number | null;
}): BoostingReadiness {
  const { keySet, endpoint, endpointProblem, markupPercent, fxRate } = input;

  let endpointHost: string | null = null;
  if (endpoint) {
    try {
      endpointHost = new URL(endpoint).host;
    } catch {
      endpointHost = null;
    }
  }

  const endpointState: StepState = !endpoint
    ? "todo"
    : endpointProblem || !endpointHost
      ? "blocked"
      : "done";

  const steps: ReadinessStep[] = [
    {
      id: "key",
      label: "Supplier key",
      state: keySet ? "done" : "todo",
      detail: keySet
        ? "A key is set. Its value is never displayed, here or anywhere else."
        : "Set the key your supplier issued. Without it no boost is listed or sold.",
      env: "SMM_PANEL_API_KEY",
    },
    {
      id: "endpoint",
      label: "Supplier endpoint",
      state: endpointState,
      detail:
        endpointState === "done"
          ? `Requests go to ${endpointHost}.`
          : endpointState === "blocked"
            ? (endpointProblem ?? "That address is not a usable https endpoint.")
            : "A key with no endpoint has nowhere to be sent.",
      env: "SMM_PANEL_API_URL",
    },
    {
      id: "margin",
      label: "Retail margin",
      state: "done",
      detail: `${markupPercent}% on top of wholesale, rounded up to whole naira. Range 0–${MAX_MARKUP}.`,
      env: "SMM_MARKUP_PERCENT",
    },
    {
      id: "fx",
      label: "Naira conversion",
      state: fxRate === null ? "optional" : "done",
      detail:
        fxRate === null
          ? "Not set. Only needed if the supplier bills in USD — and then it is required: a USD panel without a rate has no price, so its listings stay read-only."
          : "A rate is set, so a USD-billed supplier is priced in naira.",
      env: "SMM_USD_NGN_RATE",
    },
    {
      id: "live",
      label: "One real test order",
      state: "todo",
      detail:
        "Fund a small float, run the live check below, then buy the smallest quantity of one service yourself and read its status back. Announce the service only after that.",
    },
  ];

  return {
    configured: keySet && endpointState === "done",
    endpointHost,
    markupPercent,
    fxRate,
    steps,
    readyForPricing: keySet && endpointState === "done" && markupPercent >= 0,
  };
}

/** The headline an operator reads first. */
export function readinessHeadline(readiness: BoostingReadiness): string {
  if (!readiness.configured) return "Boosting is off — nothing is listed and no order can be placed.";
  if (readiness.fxRate === null) {
    return "Boosting is on for naira-billed suppliers. Run the live check: if yours bills in USD, set the rate or its listings stay read-only.";
  }
  return "Boosting is configured. Run the live check to confirm the supplier answers, then place one test order.";
}
