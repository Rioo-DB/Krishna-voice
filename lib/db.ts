import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { DEVICE_COOKIE, dbConfigured, isUuid } from "@/lib/device";

export { dbConfigured, isUuid };

let client: SupabaseClient | null = null;
export function db() {
  if (!dbConfigured) return null;
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function deviceId() {
  const id = (await cookies()).get(DEVICE_COOKIE)?.value;
  return isUuid(id) ? id : null;
}

// Per-browser limit, plus a cap across everyone: without login a person can clear
// cookies, so the global cap is what actually bounds the fal bill.
const perDevice = () => Number(process.env.DAILY_MINUTES_LIMIT ?? 30);
const global = () => Number(process.env.GLOBAL_DAILY_MINUTES ?? 180);

/** Minutes this browser may still talk today, or null when there is no database. */
export async function remainingMinutes(device: string | null) {
  const supa = db();
  if (!supa || !device) return null;
  const { data, error } = await supa.rpc("krishna_minutes", { p_device: device });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { device_minutes: number; all_minutes: number } | undefined;
  const mine = Number(row?.device_minutes ?? 0);
  const all = Number(row?.all_minutes ?? 0);
  return Math.max(0, Math.min(perDevice() - mine, global() - all));
}
