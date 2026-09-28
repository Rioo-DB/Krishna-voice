/** httpOnly cookie holding this browser's random id (set by proxy.ts). There is no login. */
export const DEVICE_COOKIE = "kv_device";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Supabase stores transcripts and minutes. Without it (local dev) nothing is saved and there is no quota. */
export const dbConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
