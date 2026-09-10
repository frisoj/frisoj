import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from "@/lib/supabase/types";

/** Pure guard used by the admin status-change action; kept separate (no
 * "use server"/Next.js imports) so it's directly unit-testable. */
export function isValidStatusTransition(current: OrderStatus, next: OrderStatus): boolean {
  return (ORDER_STATUS_TRANSITIONS[current] ?? []).includes(next);
}

export function assertValidStatusTransition(current: OrderStatus, next: OrderStatus): void {
  if (!isValidStatusTransition(current, next)) {
    throw new Error(`Statusovergang van "${current}" naar "${next}" is niet toegestaan.`);
  }
}
