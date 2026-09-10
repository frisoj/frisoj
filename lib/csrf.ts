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
