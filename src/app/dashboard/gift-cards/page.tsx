import { GiftCardsManager } from "./GiftCardsManager";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const user = await requireUser("/dashboard/gift-cards");
  const preview = isPreviewDatabase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Gift Cards</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          {preview ? "Try creating and redeeming a fictional gift card." : "Send Pryva credit to friends, family or team members."}
        </p>
      </div>
      <GiftCardsManager user={user} preview={preview} />
    </div>
  );
}
