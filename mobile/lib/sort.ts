import { daysUntil } from './dates.ts';
import type { Item } from './types.ts';

const URGENCY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Open items first; overdue/soonest deadline first; undated by urgency then newest. */
export function sortItems(items: Item[], now = new Date()): Item[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.deadline ? daysUntil(a.deadline, now) : Infinity;
    const db = b.deadline ? daysUntil(b.deadline, now) : Infinity;
    if (da !== db) return da - db;
    if (a.urgency !== b.urgency) return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    return b.createdAt.localeCompare(a.createdAt);
  });
}
