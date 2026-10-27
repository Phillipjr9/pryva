import { NextResponse } from "next/server";
import { dataPlans, getDataPlansByProvider, type AirtimeProvider } from "@/lib/airtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") as AirtimeProvider | null;

    const plans = provider ? getDataPlansByProvider(provider) : dataPlans;

    return NextResponse.json({
      ok: true,
      plans,
    });
  } catch (error) {
    console.error("Failed to fetch data plans:", error);
    return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}
