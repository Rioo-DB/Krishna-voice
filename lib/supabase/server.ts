import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase as the signed-in user (their session cookie), for Server Components and route handlers. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* called from a Server Component; proxy.ts refreshes the session */
          }
        },
      },
    },
  );
}
