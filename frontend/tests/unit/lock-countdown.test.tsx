/**
 * The countdown chip (T030, FR-008a, CHK015).
 *
 * The edge values are the point. A suspended tab or a clock adjustment can put the deadline in
 * the past, and the chip must show 00:00 rather than counting into negative time — the lock
 * itself is authoritative, this is only its display.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { formatRemaining, LockCountdown } from '../../src/features/shell/LockCountdown.js';

const getLockAt = vi.fn<() => number | null>();
vi.mock('../../src/vault/auto-lock.js', () => ({ getLockAt: () => getLockAt() }));

beforeEach(() => {
  vi.useFakeTimers();
  getLockAt.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('formatting', () => {
  it('renders mm:ss zero-padded', () => {
    expect(formatRemaining(12 * 60_000 + 40_000)).toBe('12:40');
    expect(formatRemaining(65_000)).toBe('01:05');
    expect(formatRemaining(9_000)).toBe('00:09');
  });

  it('clamps a past deadline to 00:00 rather than going negative', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(-1)).toBe('00:00');
    expect(formatRemaining(-90 * 60_000)).toBe('00:00');
  });
});

describe('rendering', () => {
  it('renders nothing when the vault is locked', () => {
    getLockAt.mockReturnValue(null);
    const { container } = render(<LockCountdown />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the remaining time while unlocked', () => {
    getLockAt.mockReturnValue(Date.now() + 12 * 60_000 + 40_000);
    const { container } = render(<LockCountdown />);
    expect(container.textContent).toContain('Locks in 12:40');
  });

  it('is a timer that never announces itself', () => {
    getLockAt.mockReturnValue(Date.now() + 60_000);
    render(<LockCountdown />);
    const chip = screen.getByRole('timer');
    expect(chip.getAttribute('aria-live')).toBe('off');
  });

  /*
   * The regression this file was missing. The first version stored the DEADLINE in state; the
   * deadline does not change while the user is idle, so React bailed out of re-rendering and the
   * chip sat frozen — updating only on interaction, which is backwards for a countdown. Asserting
   * the first render alone could never catch it: the text has to be watched over time.
   */
  it('counts down while the user is idle', async () => {
    const deadline = Date.now() + 15 * 60_000;
    getLockAt.mockReturnValue(deadline);
    const { container } = render(<LockCountdown />);
    expect(container.textContent).toContain('Locks in 15:00');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain('Locks in 14:59');

    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(container.textContent).toContain('Locks in 14:00');
  });

  it('shows 00:00 rather than negative time once the deadline has passed', async () => {
    getLockAt.mockReturnValue(Date.now() + 2000);
    const { container } = render(<LockCountdown />);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(container.textContent).toContain('Locks in 00:00');
    expect(container.textContent).not.toContain('-');
  });

  it('stops polling once unmounted', () => {
    getLockAt.mockReturnValue(Date.now() + 60_000);
    const { unmount } = render(<LockCountdown />);
    const callsAtUnmount = getLockAt.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(getLockAt.mock.calls.length).toBe(callsAtUnmount);
  });
});
