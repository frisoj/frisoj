import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowedAdminEmail } from "@/lib/admin-allowlist";

// Protects every /admin/* route except /admin/login: requires a valid
// Supabase Auth session AND that session's email to be in ADMIN_EMAILS.
// Runs on the edge/middleware runtime, so it uses the anon key (safe for
// public exposure) + the request's auth cookies — never the service role
// key, which never leaves server-only code (lib/supabase/server.ts).
export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/admin")) return NextResponse.next();
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // No Supabase project configured yet — admin cannot function until one
    // is provisioned (see DECISIONS.md). Redirect to login, which shows a
    // clear message rather than a confusing crash.
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user || !isAllowedAdminEmail(data.user.email)) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
