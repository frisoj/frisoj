import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { isAllowedAdminEmail } from "@/lib/admin-allowlist";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";

// POST /api/admin/login — server-side admin sign-in. Moved off the client
// SDK (which called supabase.auth.signInWithPassword directly from the
// browser with no way to rate-limit it) so brute-force attempts against
// admin credentials are throttled per IP, matching every other
// public-facing form on the site (checkout, contact, order lookup, review
// submission). Supabase Auth applies its own account-level protections too
// (see Supabase dashboard), but that alone doesn't rate-limit *this app's*
// endpoint. proxy.ts still re-checks the allowlist on every /admin request
// — the extra check here just avoids setting a session cookie at all for a
// non-allowlisted email.
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`admin-login:${ip}`, 8, 5 * 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Te veel inlogpogingen. Probeer het later opnieuw." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Vul een geldig e-mailadres en wachtwoord in." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "Supabase is nog niet geconfigureerd." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return NextResponse.json({ error: "Inloggen mislukt. Controleer je e-mailadres en wachtwoord." }, { status: 401 });
  }

  if (!isAllowedAdminEmail(data.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Inloggen mislukt. Controleer je e-mailadres en wachtwoord." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
