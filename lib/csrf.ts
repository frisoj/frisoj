import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

// Lightweight double-submit-cookie CSRF protection for the checkout POST.
// The checkout flow has no auth session/cookie to hijack, but the brief
// asks for CSRF protection on state-changing endpoints, so this guards
// against a third-party site silently POSTing to /api/checkout on a
// visitor's behalf: the request must carry the same token in both an
// `x-csrf-token` header and the `csrf_token` cookie, which a cross-site
// request cannot read (same-origin policy) even though it can send cookies.

const COOKIE_NAME = "csrf_token";

// Reads the token for use in a Server Component (the checkout/thank-you/
// contact pages read this to embed in their forms). It never creates the
// cookie itself: Server Components cannot mutate cookies ("Cookies can
// only be modified in a Server Action or Route Handler") — that throws in
// production (`next start`), not just in theory — so proxy.ts (middleware)
// guarantees the cookie already exists for these exact routes before the
// page renders. See proxy.ts's `ensureCsrfCookie`.
export async function getCsrfToken(): Promise<string> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? "";
}

// Kept for any future Server Action / Route Handler that needs to both
// read and, if absent, create the token in a context where mutating
// cookies is actually allowed.
export async function getOrCreateCsrfToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;
  const token = randomUUID();
  store.set(COOKIE_NAME, token, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 2 });
  return token;
}

export function verifyCsrfToken(cookieValue: string | undefined, headerValue: string | null): boolean {
  return Boolean(cookieValue) && Boolean(headerValue) && cookieValue === headerValue;
}

export { COOKIE_NAME as CSRF_COOKIE_NAME };
