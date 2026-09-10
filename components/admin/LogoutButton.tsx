"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LogoutButton() {
  const router = useRouter();

  async function handleClick() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleClick} className="text-sm font-medium text-ink-muted hover:text-accent">
      Uitloggen
    </button>
  );
}
