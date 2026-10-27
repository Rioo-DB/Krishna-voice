import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured } from "@/lib/config";

// Paths a signed-out visitor may open: the login page, email-link callbacks, setting a new password
const PUBLIC = ["/login", "/auth", "/reset"];

// Next 16: "middleware" is now "proxy". Refreshes the Supabase session and sends
// signed-out visitors to /login. Talking to Krishna needs an account.
export async function proxy(request: NextRequest) {
  // In production the database is required: accounts, and the daily cap that bounds the fal bill
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
  if (!dbConfigured) return NextResponse.next(); // local try mode: no login

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) return new NextResponse("Sign in first.", { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pcm-recorder.js|silence.wav|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
