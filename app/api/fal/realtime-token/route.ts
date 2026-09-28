import { deviceId, remainingMinutes } from "@/lib/db";

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

  // 2. Daily minutes, per browser and across everyone (soft: an open socket keeps
  //    running until the client ends it, so also set a spend limit in fal)
  const left = await remainingMinutes(await deviceId()).catch(() => 0);
  if (left !== null && left <= 0) {
    return new Response("Today's minutes are used up. Come back tomorrow.", { status: 429 });
  }

  // 3. Mint a short-lived token scoped to this one app. Same call the fal
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
