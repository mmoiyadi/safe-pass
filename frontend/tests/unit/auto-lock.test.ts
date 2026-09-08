/**
 * Characterisation of the auto-lock timer (T009, FR-008, Principle IV).
 *
 * Written against the CURRENT, UNMODIFIED `auto-lock.ts` and run before the redesign touches it.
 * A test written afterwards passes by construction and proves nothing about preservation.
 *
 * What is pinned here is the security contract, not the implementation: 15 minutes is a CEILING
 * that may only be configured downward, activity postpones the lock, and a locked vault arms
 * nothing. The redesign adds a read of the deadline (T029) and must change none of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let unlocked = true;
const lockSpy = vi.fn();

vi.mock('../../src/vault/keyring.js', () => ({
  isUnlocked: () => unlocked,
  lock: () => lockSpy(),
}));

// Module-level `timer`/`minutes`/`started` persist across imports, so each test gets a fresh
// module rather than inheriting the previous test's configured interval.
async function freshModule() {
  vi.resetModules();
  return import('../../src/vault/auto-lock.js');
}

beforeEach(() => {
  vi.useFakeTimers();
  unlocked = true;
  lockSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the 15-minute ceiling', () => {
  it('states 15 as both the maximum and the default', async () => {
    const m = await freshModule();
    expect(m.MAX_MINUTES).toBe(15);
    expect(m.DEFAULT_MINUTES).toBe(15);
  });

  it('clamps a longer request down to the ceiling rather than refusing it', async () => {
    const m = await freshModule();
    expect(m.configureAutoLock(60)).toBe(15);
    expect(m.configureAutoLock(16)).toBe(15);
  });

  it('clamps a shorter-than-a-minute request up to one minute', async () => {
    const m = await freshModule();
    expect(m.configureAutoLock(0)).toBe(1);
    expect(m.configureAutoLock(-5)).toBe(1);
  });

  it('floors a fractional request', async () => {
    const m = await freshModule();
    expect(m.configureAutoLock(5.9)).toBe(5);
  });

  it('honours a value inside the range unchanged', async () => {
    const m = await freshModule();
    expect(m.configureAutoLock(10)).toBe(10);
  });
});

describe('locking on schedule', () => {
  it('locks once the configured interval elapses', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    vi.advanceTimersByTime(15 * 60_000 - 1);
    expect(lockSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });

  it('locks at the clamped interval, not the requested one', async () => {
    const m = await freshModule();
    m.configureAutoLock(60); // clamped to 15
    vi.advanceTimersByTime(15 * 60_000);
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });
});

describe('activity postpones the deadline', () => {
  it('restarts the interval from the moment of activity', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);

    vi.advanceTimersByTime(14 * 60_000);
    m.restartAutoLock();

    // Would have fired at 15 minutes had the reset not moved it.
    vi.advanceTimersByTime(14 * 60_000);
    expect(lockSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });
});

describe('a locked vault arms nothing', () => {
  it('does not schedule a lock while the keyring is already locked', async () => {
    const m = await freshModule();
    unlocked = false;
    m.restartAutoLock();
    vi.advanceTimersByTime(60 * 60_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('clears a pending timer when reset finds the vault locked', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    unlocked = false;
    m.restartAutoLock(); // clears, then early-returns before rescheduling
    vi.advanceTimersByTime(60 * 60_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('stopAutoLock cancels a pending lock', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    m.stopAutoLock();
    vi.advanceTimersByTime(60 * 60_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });
});

/*
 * The deadline accessor the countdown reads (T028, FR-008, CHK015).
 *
 * Written BEFORE `getLockAt` exists, so these fail first — Principle IV, because auto-lock is
 * session lifecycle. The danger this pins is specific and easy to introduce: a chip that polls
 * once a second could trip one of the five activity listeners and keep the vault unlocked
 * forever. Reading the deadline must be inert.
 */
describe('reading the deadline (T029)', () => {
  it('reports a deadline while unlocked', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    expect(m.getLockAt()).toBe(Date.now() + 15 * 60_000);
  });

  it('reports the clamped deadline, not the requested one', async () => {
    const m = await freshModule();
    m.configureAutoLock(60);
    expect(m.getLockAt()).toBe(Date.now() + 15 * 60_000);
  });

  it('reports null while the vault is locked', async () => {
    const m = await freshModule();
    unlocked = false;
    m.restartAutoLock();
    expect(m.getLockAt()).toBeNull();
  });

  it('moves the deadline forward when activity resets the timer', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    const before = m.getLockAt();

    vi.advanceTimersByTime(5 * 60_000);
    m.restartAutoLock();

    expect(m.getLockAt()).toBe(before! + 5 * 60_000);
  });

  it('does not extend the deadline merely by being read', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);
    const deadline = m.getLockAt();

    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 50; i += 1) m.getLockAt();

    expect(m.getLockAt()).toBe(deadline);
  });

  it('still locks on time while a once-a-second poll runs — reading is not activity', async () => {
    const m = await freshModule();
    m.configureAutoLock(15);

    // Exactly what LockCountdown does: read the deadline every second for the whole window.
    for (let second = 0; second < 15 * 60; second += 1) {
      vi.advanceTimersByTime(1000);
      m.getLockAt();
    }

    expect(lockSpy).toHaveBeenCalledTimes(1);
  });

  it('reports null once the vault has locked itself', async () => {
    const m = await freshModule();
    m.configureAutoLock(1);
    unlocked = false; // the real `lock()` clears the keyring; the mock mirrors that
    vi.advanceTimersByTime(60_000);
    expect(m.getLockAt()).toBeNull();
  });
});
