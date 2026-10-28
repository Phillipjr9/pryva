import { randomBytes, randomUUID } from "node:crypto";
import { mutatePreviewDatabase, readPreviewDatabase, type PreviewState } from "@/db";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, demoReference } from "@/lib/demo-wallet";
import { DemoStockError } from "@/lib/demo-services";

const DEMO_LISTINGS = [
  { slug: "demo-instagram", title: "Instagram sample account", category: "Social", price: 1200, initialStock: 80 },
  { slug: "demo-facebook", title: "Facebook sample account", category: "Social", price: 1000, initialStock: 80 },
  { slug: "demo-tiktok", title: "TikTok sample account", category: "Social", price: 1400, initialStock: 80 },
  { slug: "demo-gmail", title: "Gmail sample account", category: "Email", price: 750, initialStock: 80 },
  { slug: "demo-discord", title: "Discord sample account", category: "Community", price: 900, initialStock: 80 },
  { slug: "demo-spotify", title: "Spotify sample account", category: "Entertainment", price: 1500, initialStock: 80 },
] as const;

function inventoryIn(state: PreviewState, userId: string) {
  return DEMO_LISTINGS.map((listing) => {
    const matching = state.orders.filter((order) => order.provider === "simulated" && order.demoListing === listing.slug && order.status === "delivered");
    const quantity = (order: (typeof matching)[number]) => typeof order.demoUnitsPurchased === "number" && Number.isSafeInteger(order.demoUnitsPurchased) ? Math.max(0, order.demoUnitsPurchased) : 0;
    return {
      slug: listing.slug, title: listing.title, category: listing.category, price: listing.price,
      stock: Math.max(0, listing.initialStock - matching.reduce((sum, order) => sum + quantity(order), 0)),
      owned: matching.filter((order) => order.userId === userId).reduce((sum, order) => sum + quantity(order), 0),
    };
  });
}

export function demoMarketplaceInventory(userId: string) {
  return readPreviewDatabase((snapshot) => inventoryIn(snapshot, userId));
}

export function buyDemoAccounts(input: { userId: string; slug: string; quantity: number; requestId: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId) || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) throw new Error("Invalid demo purchase");
  const listing = DEMO_LISTINGS.find((candidate) => candidate.slug === input.slug);
  if (!listing) throw new Error("Invalid demo listing");
  const reference = demoReference("DMKT", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const user = draft.users.find((row) => row.id === input.userId);
    if (!user || typeof user.walletBalance !== "number" || !Number.isSafeInteger(user.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.orders.find((row) => row.userId === input.userId && row.reference === reference);
    if (previous) {
      if (previous.demoListing !== listing.slug || previous.demoUnitsPurchased !== input.quantity) throw new DemoConflict("This demo request was already used for another purchase.");
      return { orderId: String(previous.id), reference, duplicate: true };
    }
    const stock = inventoryIn(draft, input.userId).find((row) => row.slug === listing.slug)?.stock ?? 0;
    if (stock < input.quantity) throw new DemoStockError("Not enough demo accounts are left in stock.");
    const total = listing.price * input.quantity;
    if (user.walletBalance < total) throw new DemoBalanceError("Your demo wallet balance is too low. Add demo funds to continue.");
    const balance = user.walletBalance - total;
    const id = randomUUID();
    const now = new Date();
    const samples = Array.from({ length: input.quantity }, () => `demo-${randomBytes(5).toString("hex")}@example.test · fictional sample, not a login`);
    user.walletBalance = balance;
    draft.orders.push({
      id, reference, userId: input.userId, service: "accounts", productSlug: listing.slug, productName: listing.title,
      planLabel: `${input.quantity} × demo account`, region: "Demo", duration: "Simulated delivery", amount: total,
      status: "delivered", provider: "simulated", providerRequestId: null, referenceCode: "Fictional sample accounts",
      otpCode: null, accounts: JSON.stringify(samples), expiresAt: null, refundedAt: null, createdAt: now,
      demoListing: listing.slug, demoUnitsPurchased: input.quantity,
    });
    draft.walletTransactions.push({
      id: randomUUID(), userId: input.userId, orderId: id, type: "debit", amount: total, balanceAfter: balance,
      description: `Demo accounts · ${listing.title}`, reference, createdAt: now,
    });
    return { orderId: id, reference, duplicate: false };
  });
}
