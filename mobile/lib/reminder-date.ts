import { daysUntil } from './dates.ts';

/** Reminder 2 days before the deadline at 09:00 (or tomorrow 09:00 if that is already past). */
export function reminderDate(deadlineIso: string, now = new Date()): Date | null {
  if (daysUntil(deadlineIso, now) < 0) return null;
  const [y, m, d] = deadlineIso.split('-').map(Number);
  const when = new Date(y, m - 1, d - 2, 9, 0, 0);
  if (when.getTime() > now.getTime()) return when;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  const deadlineDay = new Date(y, m - 1, d, 23, 59, 0);
  return tomorrow.getTime() <= deadlineDay.getTime() ? tomorrow : null;
}
