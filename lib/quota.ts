import type { SupabaseClient } from "@supabase/supabase-js";

export const dailyLimit = () => Number(process.env.DAILY_MINUTES_LIMIT ?? 30);

export async function minutesUsedToday(supabase: SupabaseClient) {
  const { data } = await supabase.rpc("krishna_minutes_used_today");
  return Number(data ?? 0);
}
