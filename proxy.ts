import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { TRY_MODE } from "@/lib/mode";

// Next 16: "middleware" is now "proxy". Refreshes the Supabase session and
// sends logged-out visitors to /login.
export async function proxy(request: NextRequest) {
  if (TRY_MODE) return request.nextUrl.pathname === "/history"
    ? NextResponse.redirect(new URL("/", request.url))
    : NextResponse.next();

  // A deploy without Supabase settings would otherwise crash every page with a bare 500
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey || !process.env.FAL_KEY) {
    const missing = [
      !sbUrl && "NEXT_PUBLIC_SUPABASE_URL",
      !sbKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      !process.env.FAL_KEY && "FAL_KEY",
    ].filter(Boolean);
    return new NextResponse(
      `Talk to Krishna isn't configured yet. Add these environment variables in Vercel ` +
        `(Settings → Environment Variables), then redeploy: ${missing.join(", ")}`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    sbUrl,
    sbKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) return new NextResponse("Sign in first.", { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pcm-recorder.js|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
