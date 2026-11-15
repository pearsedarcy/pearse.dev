// The "Updated <Month YYYY>" stamp on /now/ and /cv/ (#289), and the rule that keeps the CV's
// stamp honest against git. Pure: no clock, no git, no file reads. The impure half (git log and
// the real clock) lives in tests/cv-updated.test.mjs. Imports only ./site.ts, so the tests load
// it under Node's type stripping.
import { formatMonthYear } from './site.ts';

/** "October 2026" (en-GB, UTC): the label both stamps show, so /now/ and /cv/ cannot drift apart. */
export function updatedLabel(date: Date): string {
  return formatMonthYear(date);
}

/** The largest UTC offset in use (UTC+14). A date stamped in local time is never further ahead of UTC. */
export const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

/** `YYYY-MM` of a frontmatter date (a UTC midnight). */
export function stampMonth(updated: Date): string {
  if (Number.isNaN(updated.getTime())) throw new Error('updated is not a valid date');
  return updated.toISOString().slice(0, 7);
}

/**
 * `YYYY-MM` of an ISO 8601 timestamp with offset (git's `%aI`), read in the commit's own offset:
 * `2026-11-30T23:30:00-05:00` is November, although it is already December in UTC.
 */
export function commitMonth(iso: string): string {
  const m = /^(\d{4}-\d{2})-\d{2}T/.exec(iso.trim());
  if (!m) throw new Error(`not an ISO 8601 timestamp: ${JSON.stringify(iso)}`);
  return m[1];
}

export type StampState = 'ok' | 'stale' | 'future';

/**
 * Is the stamp honest? `stale` when its month is earlier than the last change's month (in the
 * change's own offset); `future` when its day (UTC midnight) is later than `now` + 14 h, so a
 * commit made just after local midnight on the 1st, east of UTC, still passes in UTC CI.
 * `now` is an argument: this never reads the clock.
 */
export function stampCheck({ updated, lastChangeIso, now }: { updated: Date; lastChangeIso: string; now: Date }): StampState {
  if (stampMonth(updated) < commitMonth(lastChangeIso)) return 'stale';
  if (updated.getTime() > now.getTime() + MAX_UTC_OFFSET_MS) return 'future';
  return 'ok';
}
