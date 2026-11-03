import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import { orders, users } from "@/db/schema";

/**
 * The customer-facing half of the review funnel: `/dashboard/reviews` offers a
 * dropdown of purchases to review. For four of this shop's product lines it
 * offered nothing at all.
 *
 * eSIM, boosting, account batches and scheduled purchases all settle on `active`,
 * and the eligibility list only accepted `delivered` plus `completed` — a word no
 * writer in the app has ever put on an order. So a customer who paid for an
 * installed eSIM was told, in the page's own words, that there was nothing to
 * review yet.
 *
 * Rendered rather than unit-tested because the defect the customer met was a
 * missing option, not an API answer.
 */

const BUYER = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: BUYER, email: "buyer@pryva.ng" }),
}));

beforeAll(async () => {
  await db.insert(users).values({
    id: BUYER,
    name: "Ada Demo",
    email: "buyer@pryva.ng",
    passwordHash: "hash",
    walletBalance: 0,
    emailVerifiedAt: new Date(),
  });

  const seed = [
    {
      id: "55555555-5555-4555-8555-555555555501",
      reference: "PV-ESIM-ACTIVE",
      service: "esim",
      productSlug: "esim-ng-1gb",
      productName: "Nigeria eSIM 1GB",
      planLabel: "1GB for 30 days",
      amount: 4700,
      status: "active",
    },
    {
      id: "55555555-5555-4555-8555-555555555502",
      reference: "PV-BOOST-ACTIVE",
      service: "social",
      productSlug: "ig-followers",
      productName: "Instagram followers",
      planLabel: "1,000 followers",
      amount: 2400,
      status: "active",
    },
    {
      id: "55555555-5555-4555-8555-555555555503",
      reference: "PV-NUMBER-PROCESSING",
      service: "numbers",
      productSlug: "vn-ng",
      productName: "Virtual Numbers",
      planLabel: "Nigeria number",
      amount: 1340,
      status: "processing",
    },
  ];

  for (const row of seed) {
    await db
      .insert(orders)
      .values({ ...row, userId: BUYER, region: "Nigeria", duration: "30 days", provider: "preview", refundedAt: null });
  }
});

async function render() {
  const { default: ReviewsPage } = await import("@/app/dashboard/reviews/page");
  return renderToStaticMarkup(await ReviewsPage());
}

describe("the reviews page offers what the customer actually received", () => {
  it("lists an installed eSIM and a delivered boost", async () => {
    const html = await render();
    expect(html).toContain("Nigeria eSIM 1GB · 1GB for 30 days · PV-ESIM-ACTIVE");
    expect(html).toContain("Instagram followers · 1,000 followers · PV-BOOST-ACTIVE");
    expect(html).not.toContain("Nothing to review yet");
  });

  it("still withholds an order that has not been settled", async () => {
    const html = await render();
    expect(html).not.toContain("PV-NUMBER-PROCESSING");
  });
});
