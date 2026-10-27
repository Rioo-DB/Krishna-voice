import { createClient } from "@/lib/supabase/server";
import { toEmail } from "@/lib/config";

/**
 * Password sign-in on the server, so a username's email domain (USERNAME_DOMAIN)
 * never reaches the browser. The session cookies are set on this response.
 */
export async function POST(req: Request) {
  const { login, password } = (await req.json().catch(() => ({}))) as { login?: string; password?: string };
  if (!login || !password) return Response.json({ error: "Enter your email or username and password." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: toEmail(login), password });
  if (error) return Response.json({ error: error.message }, { status: 401 });
  return Response.json({ ok: true });
}
