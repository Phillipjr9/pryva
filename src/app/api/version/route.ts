import { BUILD_ID } from "@/lib/build-id";

export const dynamic = "force-dynamic";

/** The build the server is running right now. Never cached. */
export function GET() {
  return Response.json(
    { build: BUILD_ID },
    { headers: { "Cache-Control": "no-store" } },
  );
}
