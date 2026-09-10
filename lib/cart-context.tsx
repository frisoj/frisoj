"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CartItem } from "@/lib/cart";
import { calculateCartTotals } from "@/lib/cart";

// Cart persistence: a single JSON cookie ("pl_cart"), read/written entirely
// client-side. Chosen over localStorage because it is the simplest option
// that satisfies "persists across reload" without needing a server session
// or a signed-in customer (see DECISIONS.md for the tradeoff notes — a
// cookie is sent on every request, which is irrelevant here since nothing
// server-side reads it; it was picked purely for simplicity, matching the
// brief's "cookie-based is fine, simplest choice").

const COOKIE_NAME = "pl_cart";
const COOKIE_MAX_AGE_DAYS = 30;

function readCartCookie(): CartItem[] {
  if (typeof document === "undefined") return [];
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function writeCartCookie(items: CartItem[]) {
  if (typeof document === "undefined") return;
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(items))}; path=/; max-age=${maxAge}; samesite=lax`;
}

type CartContextValue = {
  items: CartItem[];
  totals: ReturnType<typeof calculateCartTotals>;
  addItem: (item: CartItem, options?: { openDrawer?: boolean }) => void;
  removeItem: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  isHydrated: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Whatever element had focus when the drawer was opened (an "In
  // winkelwagen" button, the header's cart icon, ...) — restored on close
  // so keyboard/screen-reader users land back where they were, not at the
  // top of the page.
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // Cart cookie is only readable client-side, so hydrate after mount to
  // avoid a server/client markup mismatch. This one-time bootstrap from an
  // external store (the cookie) on mount is the documented exception to
  // "don't setState in an effect" — there is no reactive dependency to
  // otherwise derive this from.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readCartCookie());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) writeCartCookie(items);
  }, [items, isHydrated]);

  const addItem = useCallback((item: CartItem, options?: { openDrawer?: boolean }) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId);
      if (existing) {
        return prev.map((i) =>
          i.variantId === item.variantId ? { ...i, quantity: i.quantity + item.quantity } : i,
        );
      }
      return [...prev, item];
    });
    if (options?.openDrawer !== false) {
      if (typeof document !== "undefined") {
        triggerElementRef.current = document.activeElement as HTMLElement | null;
      }
      setIsDrawerOpen(true);
    }
  }, []);

  const removeItem = useCallback((variantId: string) => {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId));
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) return prev.filter((i) => i.variantId !== variantId);
      return prev.map((i) => (i.variantId === variantId ? { ...i, quantity } : i));
    });
  }, []);

  const clearCart = useCallback(() => setItems([]), []);
  const openDrawer = useCallback(() => {
    if (typeof document !== "undefined") {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
    }
    setIsDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    triggerElementRef.current?.focus?.();
    triggerElementRef.current = null;
  }, []);

  const totals = useMemo(() => calculateCartTotals(items), [items]);

  const value = useMemo(
    () => ({ items, totals, addItem, removeItem, setQuantity, clearCart, isDrawerOpen, openDrawer, closeDrawer, isHydrated }),
    [items, totals, addItem, removeItem, setQuantity, clearCart, isDrawerOpen, openDrawer, closeDrawer, isHydrated],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
