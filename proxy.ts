import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, dbConfigured, isUuid } from "@/lib/device";

// Next 16: "middleware" is now "proxy". There is no login: each browser gets a
// random id in an httpOnly cookie, which scopes its transcripts and minutes.
export function proxy(request: NextRequest) {
  // In production the database is required: its daily cap is what bounds the fal bill
  const missing = [
    !process.env.FAL_KEY && "FAL_KEY",
    process.env.NODE_ENV === "production" && !dbConfigured && "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);
  if (missing.length) {
    return new NextResponse(
      `Talk to Krishna isn't configured yet. Add these environment variables in Vercel ` +
        `(Settings → Environment Variables), then redeploy: ${missing.join(", ")}`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (isUuid(request.cookies.get(DEVICE_COOKIE)?.value)) return NextResponse.next();

  // First visit: mint the id, and pass it to this request too so route handlers see it
  const id = crypto.randomUUID();
  request.cookies.set(DEVICE_COOKIE, id);
  const response = NextResponse.next({ request });
  response.cookies.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pcm-recorder.js|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
