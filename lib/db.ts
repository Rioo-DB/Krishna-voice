import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { dbConfigured, isUuid } from "@/lib/config";

export { dbConfigured, isUuid };

/**
 * The signed-in user, and Supabase acting as them: the krishna_my_* functions scope
 * everything by auth.uid(). Null when signed out, or when there is no database.
 */
export async function session() {
  if (!dbConfigured) return null;
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  return user ? { supa, user } : null;
}

// Per-person limit, plus a cap across everyone: the global cap is what bounds the fal bill.
const perUser = () => Number(process.env.DAILY_MINUTES_LIMIT ?? 30);
const global = () => Number(process.env.GLOBAL_DAILY_MINUTES ?? 180);

export type Usage = { today: number; month: number; remaining: number };

/** Minutes this user has talked today and this month, and how many they may still talk today. */
export async function usage(supa: SupabaseClient): Promise<Usage> {
  const { data, error } = await supa.rpc("krishna_my_minutes");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { my_today: number; my_month: number; all_today: number } | undefined;
  const today = Number(row?.my_today ?? 0);
  const all = Number(row?.all_today ?? 0);
  return {
    today,
    month: Number(row?.my_month ?? 0),
    remaining: Math.max(0, Math.min(perUser() - today, global() - all)),
  };
}

/** Minutes this user may still talk today, or null when there is no database (local try mode). */
export async function remainingMinutes() {
  const s = await session();
  if (!s) return null;
  return (await usage(s.supa)).remaining;
}
