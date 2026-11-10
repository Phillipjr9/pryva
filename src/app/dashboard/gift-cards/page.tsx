import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Preserve old wallet-card links while keeping all gift-card actions in one category. */
export default function GiftCardsPage() {
  redirect("/dashboard/services?category=gift-cards#wallet-gifts");
}
