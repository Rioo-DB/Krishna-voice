import { createClient } from "@/lib/supabase/server";
import { dailyLimit, minutesUsedToday } from "@/lib/quota";
import { TRY_MODE } from "@/lib/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_APP = "xai/grok-voice/realtime";
const TOKEN_SECONDS = 120;

export async function POST(req: Request) {
  // 1. Only mint tokens for the Grok Voice app
  const { app } = (await req.json().catch(() => ({}))) as { app?: string };
  if (!app || !app.startsWith(ALLOWED_APP)) {
    return new Response("This token route only serves Grok Voice.", { status: 400 });
  }

  if (!TRY_MODE) {
    // 2. Must be logged in
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Sign in to talk with Krishna.", { status: 401 });

    // 3. Daily quota (soft: an open socket keeps running until the client ends it)
    const limit = dailyLimit();
    if ((await minutesUsedToday(supabase)) >= limit) {
      return new Response(`You've used today's ${limit} minutes. Come back tomorrow.`, { status: 429 });
    }
  }

  // 4. Mint a short-lived token scoped to this one app. Same call the fal
  //    client makes itself: POST /tokens/ with the app alias ("grok-voice").
  const r = await fetch("https://rest.fal.ai/tokens/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${process.env.FAL_KEY}` },
    body: JSON.stringify({ allowed_apps: [ALLOWED_APP.split("/")[1]], token_expiration: TOKEN_SECONDS }),
  });
  const token = await r.json().catch(() => null);
  if (!r.ok || typeof token !== "string") {
    console.error("fal token error", r.status, token);
    return new Response("Could not reach fal.", { status: 502 });
  }

  // fal's realtime client reads the token as plain text
  return new Response(token, { headers: { "Content-Type": "text/plain" } });
}
