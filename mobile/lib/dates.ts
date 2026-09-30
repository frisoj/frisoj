const DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from today until the ISO date (negative = overdue). */
export function daysUntil(iso: string, now = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  return Math.round((target.getTime() - startOfDay(now).getTime()) / DAY);
}

export function deadlineLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'Geen deadline';
  const n = daysUntil(iso, now);
  if (n < -1) return `${-n} dagen te laat`;
  if (n === -1) return 'Gisteren verlopen';
  if (n === 0) return 'Vandaag';
  if (n === 1) return 'Morgen';
  if (n < 14) return `Over ${n} dagen`;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
}

export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
