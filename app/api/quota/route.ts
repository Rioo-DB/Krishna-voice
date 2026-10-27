import { remainingMinutes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const remaining = await remainingMinutes().catch(() => null);
  return Response.json({ remaining });
}
