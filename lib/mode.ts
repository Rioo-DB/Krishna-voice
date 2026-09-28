/**
 * Local "try it now" mode: Supabase isn't configured yet and we're in dev.
 * No login, no quota, no saved transcripts. Never active in production.
 */
export const TRY_MODE = !process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== "production";
