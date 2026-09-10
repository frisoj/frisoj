// Only email addresses listed in ADMIN_EMAILS (comma-separated) may enter
// /admin, even if they have a valid Supabase Auth session — this is a
// second, explicit gate on top of "has an account" so a stray Supabase Auth
// sign-up can never grant admin access.
export function isAllowedAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}
