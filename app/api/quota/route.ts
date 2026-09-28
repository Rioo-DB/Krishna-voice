import { createClient } from "@/lib/supabase/server";
import { dailyLimit, minutesUsedToday } from "@/lib/quota";
import { TRY_MODE } from "@/lib/mode";

export const dynamic = "force-dynamic";

export async function GET() {
  if (TRY_MODE) return Response.json({ used: 0, limit: null, remaining: null });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const limit = dailyLimit();
  const used = await minutesUsedToday(supabase);
  return Response.json({ used, limit, remaining: Math.max(0, limit - used) });
}
