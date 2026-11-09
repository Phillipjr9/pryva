/**
 * Every product family, declared once.
 *
 * The service hub, the readiness verdicts, the coverage lanes, the admin console
 * and the delivery windows used to name the same ten families in five separate
 * lists. They drifted the way five lists do: a lane keyed on a provider no order
 * wrote, a service tagged `social` but filed under `boosts`, timeouts for
 * products that have no supplier. Nothing failed loudly — a stale list simply
 * reports "nothing has ever been bought" forever.
 *
 * So this module is the vocabulary. It is pure data and safe to import from a
 * client component: it names suppliers by *source* (`fleexa`, `smm`, ...) rather
 * than embedding the credential checks or the provider strings, which stay in
 * the server-only modules that are allowed to know them.
 *
 * Rules for adding a service:
 *   1. Add the id to `SERVICES` with its label, description and sale rule.
 *   2. `DETAIL` in `service-readiness.ts` fails to compile until it has copy.
 *   3. If it can take money, give it a lane; if its supplier is shared with
 *      another lane, the coverage page derives the filter by itself.
 */

/**
 * Every value a purchase path may write to `orders.service`.
 *
 * This is the vocabulary the database column is typed against, so a route that
 * invents a tag fails to compile instead of silently writing a value no lane,
 * report or privacy export knows about. Gift cards are here without being a hub
 * family: they are sold, and their orders carry this tag.
 */
export const ORDER_SERVICE_TAGS = [
  "numbers",
  "esim",
  "accounts",
  "social",
  "proxies",
  "data",
  "subscriptions",
  "airtime",
  "gift-cards",
  /**
   * Historical tag: paid inbox orders were sold before the inbox became free.
   * Today's temporary inbox writes no order, but old rows still carry it, so the
   * type keeps it and the sync route keeps handling it.
   */
  "email-otp",
] as const;

export type OrderServiceTag = (typeof ORDER_SERVICE_TAGS)[number];

/**
 * Compile-time guard: a family cannot declare an order tag the union lacks.
 *
 * Without it, adding `orderServices: ["numbers-rental"]` to a service would pass
 * review and fail only at the database boundary, if at all.
 */
type Assert<T extends true> = T;
type DeclaredTagsAreKnown = Assert<
  ((typeof SERVICES)[number]["orderServices"][number] & string) extends OrderServiceTag ? true : false
>;
export type _DeclaredTagsAreKnown = DeclaredTagsAreKnown;

/**
 * Customer-facing families, ordered by how often a user wants to buy them and
 * how much context they need before checkout.
 *
 * On mobile, the hierarchy must stay compact and high-signal: the highest intent
 * categories lead, while the utility/order-tools stay later.
 */
export const SERVICE_IDS = [
  "numbers",
  "esim",
  "data",
  "accounts",
  "subscriptions",
  "verification",
  "social",
  "proxies",
  "email",
  "tools",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

/** Lanes are the units the coverage console is accountable for. */
export const LANE_IDS = ["numbers", "esim", "accounts", "boosts", "proxies", "subscriptions", "data"] as const;

export type LaneId = (typeof LANE_IDS)[number];

/**
 * Which supplier credential decides whether a service can sell.
 *
 * A name, not a check: `service-config.ts` maps each one to the `is…Configured`
 * function, so exactly one module reads environment variables for this purpose.
 */
export type SupplierSource = "fleexa" | "smm" | "marketplace" | "bitcall";

/**
 * What a family is allowed to promise.
 *
 * `catalogue` is deliberately not `none`: app-specific verification listings are
 * browsable, and saying "not connected" would understate what a customer sees.
 */
export type SaleRule =
  | { kind: "catalogue" }
  | { kind: "free" }
  | { kind: "supplier"; source: SupplierSource }
  | { kind: "none" };

export type ServiceDefinition = {
  id: ServiceId;
  label: string;
  description: string;
  sale: SaleRule;
  /**
   * The lane this family's orders land in, when it can be bought.
   *
   * Gift cards are not here on purpose: they are Pryva-issued credit with no
   * supplier to be late, so scoring them on delivery evidence would report
   * "untested" forever.
   */
  lane: LaneId | null;
  /**
   * For a family that is a way *into* another one rather than a shelf of its own.
   *
   * Order tools are the only case: a bulk basket or a schedule buys the same plan
   * a single order buys, and records the same tag, so its delivery belongs to the
   * lane that sells that plan. It still needs a supplier to work, which is why it
   * is not `sale: "none"`.
   */
  sellsInto?: readonly ServiceId[];
  /**
   * The `orders.service` values its purchase paths write.
   *
   * Used to tell apart two families that share one supplier credential, and to
   * enforce at test time that a route cannot write a tag nobody declared.
   */
  orderServices: readonly OrderServiceTag[];
  /** How long a delivery may take before it is late, for lane scoring. */
  deliveryMinutes: number | null;
  /** How many times a failed delivery is retried, where that is implemented. */
  retry: { attempts: number; delayMs: number } | null;
};

export const SERVICES: readonly ServiceDefinition[] = [
  {
    id: "verification",
    label: "App verification",
    description: "SMS codes for apps",
    sale: { kind: "catalogue" },
    lane: null,
    orderServices: [],
    deliveryMinutes: null,
    retry: null,
  },
  {
    id: "social",
    label: "Social promotion",
    description: "Followers, likes & views",
    sale: { kind: "supplier", source: "smm" },
    lane: "boosts",
    orderServices: ["social"],
    deliveryMinutes: 10_080,
    retry: null,
  },
  {
    id: "numbers",
    label: "Number plans",
    description: "Single-use & rentals",
    sale: { kind: "supplier", source: "bitcall" },
    lane: "numbers",
    orderServices: ["numbers"],
    deliveryMinutes: 5,
    retry: { attempts: 3, delayMs: 60_000 },
  },
  {
    id: "esim",
    label: "eSIM",
    description: "Travel data plans",
    sale: { kind: "supplier", source: "bitcall" },
    lane: "esim",
    orderServices: ["esim"],
    deliveryMinutes: 5,
    retry: { attempts: 2, delayMs: 30_000 },
  },
  {
    id: "proxies",
    label: "Proxies",
    description: "Residential traffic",
    sale: { kind: "supplier", source: "fleexa" },
    lane: "proxies",
    orderServices: ["proxies"],
    deliveryMinutes: 60,
    retry: { attempts: 2, delayMs: 30_000 },
  },
  {
    id: "email",
    label: "Email OTP",
    description: "Temporary inboxes",
    sale: { kind: "free" },
    lane: null,
    orderServices: [],
    deliveryMinutes: 5,
    retry: { attempts: 3, delayMs: 60_000 },
  },
  {
    id: "accounts",
    label: "Digital accounts",
    description: "Account marketplace",
    sale: { kind: "supplier", source: "marketplace" },
    lane: "accounts",
    orderServices: ["accounts"],
    deliveryMinutes: 2_880,
    retry: null,
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    description: "Entertainment & tools",
    sale: { kind: "supplier", source: "fleexa" },
    lane: "subscriptions",
    orderServices: ["subscriptions"],
    deliveryMinutes: 1_440,
    retry: { attempts: 1, delayMs: 60_000 },
  },
  {
    id: "data",
    label: "Mobile data",
    description: "Local network plans",
    sale: { kind: "supplier", source: "fleexa" },
    lane: "data",
    orderServices: ["data", "airtime"],
    deliveryMinutes: 15,
    retry: { attempts: 2, delayMs: 60_000 },
  },
  {
    id: "tools",
    label: "Order tools",
    description: "Bulk & scheduled orders",
    sale: { kind: "supplier", source: "fleexa" },
    lane: null,
    sellsInto: ["numbers"],
    orderServices: [],
    deliveryMinutes: 60,
    retry: null,
  },
];


export const SERVICE_IDS_ALL: readonly ServiceId[] = SERVICES.map((service) => service.id);



export function serviceById(id: ServiceId): ServiceDefinition {
  const service = SERVICES.find((entry) => entry.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}

/**
 * Lane metadata: what the console says about a family that takes money.
 *
 * `staleHours` lives here rather than beside the queries because "a number
 * should resolve in minutes, a boost may take a week" is a product decision.
 * `configuredBy` names the service whose credential the verdict reads.
 */
export type LaneDefinition = {
  id: LaneId;
  label: string;
  configuredBy: ServiceId;
  staleHours: number;
  delivery: string;
  recovery: string;
};

export const LANES: readonly LaneDefinition[] = [
  {
    id: "numbers",
    label: "Virtual numbers & rentals",
    configuredBy: "numbers",
    staleHours: 2,
    delivery: "The number is issued at purchase and the code is polled onto the order page.",
    recovery:
      "Single-use number refunds require a confirmed terminal no-code outcome and a matching wallet debit; uncertain cases need review.",
  },
  {
    id: "esim",
    label: "eSIM data",
    configuredBy: "esim",
    staleHours: 1,
    delivery:
      "The profile is issued at purchase and the activation code renders on the order page, with the QR emailed.",
    recovery:
      "A purchase whose supplier call is ambiguous is parked for review rather than charged twice; a refusal is refunded.",
  },
  {
    id: "accounts",
    label: "Accounts marketplace",
    configuredBy: "accounts",
    staleHours: 48,
    delivery: "Credentials are written onto the order page the moment the supplier returns them.",
    recovery:
      "An ambiguous supplier call parks the order for review instead of charging twice; a refusal is refunded.",
  },
  {
    id: "boosts",
    label: "Social boosting",
    configuredBy: "social",
    staleHours: 168,
    delivery:
      "Opening the order reads the panel's status back; progress is shown on the order page.",
    recovery:
      "A partial or cancelled boost goes to review for a manual refund — never an automatic one.",
  },
  {
    id: "proxies",
    label: "Residential proxies",
    configuredBy: "proxies",
    staleHours: 24,
    delivery: "Proxy credentials are issued on the order page once the purchase clears.",
    recovery: "A proxy purchase that cannot be delivered is refunded to your wallet.",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    configuredBy: "subscriptions",
    staleHours: 72,
    delivery: "Subscription details are delivered to the order page when the supplier confirms.",
    recovery: "A subscription that cannot be activated is refunded to your wallet.",
  },
  {
    id: "data",
    label: "Mobile data",
    configuredBy: "data",
    staleHours: 6,
    delivery: "Data bundles are delivered to the phone number on the order page.",
    recovery: "A data bundle that fails to deliver is refunded to your wallet.",
  },
];

export function laneById(id: LaneId): LaneDefinition {
  const lane = LANES.find((entry) => entry.id === id);
  if (!lane) throw new Error(`Unknown lane: ${id}`);
  return lane;
}

/** Delivery window in milliseconds, for the sweeps that decide "too late". */
export function deliveryWindowMs(id: ServiceId): number {
  const minutes = serviceById(id).deliveryMinutes;
  if (minutes === null) throw new Error(`${id} has no delivery window`);
  return minutes * 60_000;
}
