import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase clients. NEVER import this file from a client
// component — the service-role key must never reach the browser bundle.
//
// No real Supabase project exists in this environment (see DECISIONS.md).
// `isSupabaseConfigured()` lets the data layer (lib/orders.ts etc.) fall
// back to an in-memory mock store so the app is fully testable and
// obviously-correct end to end before a real project + env vars are wired
// up — set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY to switch over.

let cached: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Service-role client for trusted server code (route handlers, server actions, cron jobs). */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cached !== undefined) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
