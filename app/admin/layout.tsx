import Link from "next/link";
import type { Metadata } from "next";
import LogoutButton from "@/components/admin/LogoutButton";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Simple, functional admin shell — no design polish needed here, just
// clear and fast, per the brief. Auth/allowlist gating happens in
// middleware.ts for every path under /admin except /admin/login.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream font-sans">
      <div className="border-b border-border bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <nav className="flex gap-4 text-sm font-semibold text-ink">
            <Link href="/admin/orders" className="hover:text-accent">Bestellingen</Link>
            <Link href="/admin/reviews" className="hover:text-accent">Reviews</Link>
            <Link href="/admin/blog" className="hover:text-accent">Blog</Link>
            <Link href="/admin/faq" className="hover:text-accent">FAQ</Link>
          </nav>
          <LogoutButton />
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
