/**
 * How the detail footer says when a secret last changed (FR-030e, CHK013).
 *
 * Labelled and formatted as "last changed", never "last used". Nothing in the system records
 * when a secret was *used* — opening and copying are deliberately not tracked — which is why the
 * "Recently used" scope was cut (FR-030a). This value answers a different question, and the
 * wording has to keep saying so.
 *
 * Past a week the relative form stops being useful ("53 days ago" tells you less than a date),
 * so it hands over to an absolute date.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeUpdated(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  // A clock adjustment can put the stamp slightly ahead; "just now" is honest and "in -3
  // minutes" is not.
  const elapsed = Math.max(0, now - then);

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (elapsed < WEEK) {
    const days = Math.floor(elapsed / DAY);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return new Date(then).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
