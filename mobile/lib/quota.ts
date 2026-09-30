export const FREE_SCANS_PER_WEEK = 3;
const WEEK = 7 * 86_400_000;

/** Scans remaining for a free user given the timestamps (ms) of earlier scans. */
export function scansLeft(scanTimes: number[], now = Date.now()): number {
  const recent = scanTimes.filter((t) => now - t < WEEK).length;
  return Math.max(0, FREE_SCANS_PER_WEEK - recent);
}
