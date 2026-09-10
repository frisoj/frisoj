"use client";

import dynamic from "next/dynamic";

// Neither the mini-cart drawer nor the cookie banner render anything on
// first paint (the drawer starts closed; the banner only appears once the
// client has checked for an existing consent cookie), so both are loaded
// as separate, client-only chunks rather than being part of the initial
// server-rendered HTML or the main hydration bundle. `ssr: false` requires
// a Client Component boundary (this file) — next/dynamic can't take that
// option directly inside the (Server Component) root layout.
const CartDrawer = dynamic(() => import("@/components/CartDrawer"), { ssr: false });
const CookieBanner = dynamic(() => import("@/components/CookieBanner"), { ssr: false });

export default function DeferredWidgets() {
  return (
    <>
      <CartDrawer />
      <CookieBanner />
    </>
  );
}
