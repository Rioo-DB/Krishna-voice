import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { TRY_MODE } from "@/lib/mode";

// Next 16: "middleware" is now "proxy". Refreshes the Supabase session and
// sends logged-out visitors to /login.
export async function proxy(request: NextRequest) {
  if (TRY_MODE) return request.nextUrl.pathname === "/history"
    ? NextResponse.redirect(new URL("/", request.url))
    : NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  // /api/mcp is called by xAI's servers, not by the user
  const isPublic = path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/api/mcp");

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
