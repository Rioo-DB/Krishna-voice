import { deviceId, remainingMinutes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const remaining = await remainingMinutes(await deviceId()).catch(() => null);
  return Response.json({ remaining });
}
