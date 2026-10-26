import { getCurrentUser } from "@/lib/auth";
import { makeReference, creditWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

const METHODS = new Set(["bank-transfer", "card"]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { amount?: number; method?: string };
    const amount = Math.round(Number(body.amount ?? 0));
    const method = METHODS.has(body.method ?? "") ? (body.method as string) : "bank-transfer";

    if (!Number.isFinite(amount) || amount < 1000) {
      return Response.json(
        { ok: false, error: "The minimum top-up is ₦1,000." },
        { status: 400 },
      );
    }
    if (amount > 500000) {
      return Response.json(
        { ok: false, error: "For top-ups above ₦500,000, please contact support." },
        { status: 400 },
      );
    }

    const reference = makeReference("TOP");
    const balance = await creditWallet({
      userId: user.id,
      amount,
      type: "credit",
      description: method === "card" ? "Wallet top-up · card" : "Wallet top-up · bank transfer",
      reference,
    });

    return Response.json({ ok: true, balance, reference });
  } catch {
    return Response.json(
      { ok: false, error: "That top-up didn't go through. Please try again." },
      { status: 500 },
    );
  }
}
