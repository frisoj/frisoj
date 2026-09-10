"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client for the admin login form (email/password sign-in
// via Supabase Auth). Uses only the public anon key — never the service
// role key, which stays server-only (lib/supabase/server.ts).
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
