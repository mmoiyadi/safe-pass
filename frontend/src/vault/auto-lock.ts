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
/** When the armed timer will fire. Display only — the timer above is what actually locks. */
let lockAt: number | null = null;

function reset(): void {
  if (timer) clearTimeout(timer);
  if (!isUnlocked()) {
    lockAt = null;
    return;
  }
  lockAt = Date.now() + minutes * 60_000;
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
  lockAt = null;
}

/**
 * The moment the vault will lock, or null when it is already locked (FR-008).
 *
 * A read, and only a read. The countdown chip polls this once a second, so it must not touch the
 * timer: calling `reset()` here — or letting the poll trip one of the five activity listeners —
 * would mean an unattended screen never locks, turning a display into a defect.
 *
 * Gated on `isUnlocked()` rather than on `lockAt` alone, because the keyring can be cleared by
 * routes that never come through this module: the Lock button, sign-out, a REAUTH_REQUIRED
 * response. In each of those `lockAt` still holds its old value, and reporting it would claim a
 * deadline for a vault that is already shut.
 */
export function getLockAt(): number | null {
  return isUnlocked() ? lockAt : null;
}

/** Exposed so the unlock flow can restart the countdown the moment keys are loaded. */
export const restartAutoLock = reset;
