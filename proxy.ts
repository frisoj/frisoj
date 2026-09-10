import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { isAllowedAdminEmail } from "@/lib/admin-allowlist";
import { CSRF_COOKIE_NAME } from "@/lib/csrf";

// Two unrelated concerns share this one middleware file because Next.js
// only runs a single proxy/middleware per app.

const CSRF_PROTECTED_PATHS = ["/afrekenen", "/contact"];
const CSRF_PROTECTED_PREFIXES = ["/bedankt/"];

function needsCsrfCookie(pathname: string): boolean {
  return CSRF_PROTECTED_PATHS.includes(pathname) || CSRF_PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

// Ensures the double-submit CSRF cookie exists before /afrekenen,
// /bedankt/[ordernummer] or /contact render — those Server Components read
// the token to embed in their forms, but Server Components are not allowed
// to *set* cookies themselves ("Cookies can only be modified in a Server
// Action or Route Handler"), so creating it has to happen here in
// middleware instead of in the page (found via a production build/start
// smoke test: the pages 500'd under `next start`, even though `next dev`
// didn't surface the error).
function ensureCsrfCookie(request: NextRequest): NextResponse {
  if (request.cookies.get(CSRF_COOKIE_NAME)?.value) return NextResponse.next();

  const token = randomUUID();
  // Set on the request too, so the Server Component rendered for *this*
  // request already sees the token via next/headers cookies().get(...).
  request.cookies.set(CSRF_COOKIE_NAME, token);
  const response = NextResponse.next({ request });
  response.cookies.set(CSRF_COOKIE_NAME, token, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 2 });
  return response;
}

// Protects every /admin/* route except /admin/login: requires a valid
// Supabase Auth session AND that session's email to be in ADMIN_EMAILS.
// Runs on the edge/middleware runtime, so it uses the anon key (safe for
// public exposure) + the request's auth cookies — never the service role
// key, which never leaves server-only code (lib/supabase/server.ts).
async function protectAdmin(request: NextRequest): Promise<NextResponse> {
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

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) {
    return protectAdmin(request);
  }
  if (needsCsrfCookie(request.nextUrl.pathname)) {
    return ensureCsrfCookie(request);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/afrekenen", "/bedankt/:path*", "/contact"],
};
