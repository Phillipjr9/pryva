import { POST as createOrder } from "../route";

export const dynamic = "force-dynamic";

/** Legacy endpoint: use the same fulfillment and wallet checks as checkout. */
export async function POST(request: Request) {
  const response = await createOrder(request);
  if (!response.ok) return response;

  const result = await response.json() as { order: { id: string } } & Record<string, unknown>;
  return Response.json({ ...result, orderId: result.order.id }, { status: response.status });
}
