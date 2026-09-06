/**
 * Auto-lock on inactivity (T054, FR-007).
 *
 * The constitution states 15 minutes as a CEILING, so the default is 15 and the value may only
 * be configured DOWNWARD. A caller asking for more is clamped rather than refused, because
 * silently granting a longer window would be the dangerous failure.
 */
import { isUnlocked, lock } from './keyring.js';

export const MAX_MINUTES = 15;
export const DEFAULT_MINUTES = 15;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'focus'] as const;

let timer: ReturnType<typeof setTimeout> | null = null;
let minutes = DEFAULT_MINUTES;
let started = false;

function reset(): void {
  if (timer) clearTimeout(timer);
  if (!isUnlocked()) return;
  timer = setTimeout(() => {
    lock();
  }, minutes * 60_000);
}

export function configureAutoLock(requestedMinutes: number): number {
  minutes = Math.min(Math.max(1, Math.floor(requestedMinutes)), MAX_MINUTES);
  reset();
  return minutes;
}

export function startAutoLock(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, reset, { passive: true });
  }
  // Locking when the tab is hidden is deliberate: an unattended screen is the common case
  // this control exists for, and a background tab cannot be watched by its owner.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reset();
  });
  reset();
}

export function stopAutoLock(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Exposed so the unlock flow can restart the countdown the moment keys are loaded. */
export const restartAutoLock = reset;
