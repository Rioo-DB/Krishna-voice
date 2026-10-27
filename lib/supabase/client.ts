import { createBrowserClient } from "@supabase/ssr";

/** Supabase in the browser, for signing in, up and out; it keeps the session in cookies. */
export const createClient = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
