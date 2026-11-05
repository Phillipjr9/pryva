import { destroySession } from "@/lib/identity/auth";
import { isSameOriginMutation } from "@/lib/platform/net";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  await destroySession();
  return Response.json({ ok: true });
}
