/**
 * How long until the vault locks itself (T030, FR-008, FR-026c, CHK015).
 *
 * A display of a deadline, never the thing that enforces it. `auto-lock.ts` owns the timer; this
 * polls `getLockAt()` and formats it. If this component were removed the vault would still lock
 * at exactly the same moment.
 *
 * Two constraints shape it:
 *
 * - It must not keep the vault open. Reading the deadline is inert (pinned by the auto-lock
 *   suite), and a poll must not trip one of the five activity listeners, so there is no event
 *   handler here at all.
 * - It must not be announced. `role="timer"` with `aria-live="off"`: a value changing every
 *   second inside a live region would talk over everything else on the page and make the
 *   interface unusable with a screen reader. The value stays available on demand.
 */
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { getLockAt } from '../../vault/auto-lock.js';
import { Icon } from '../../components/Icon.js';

const POLL_MS = 1000;
/** Below this the chip changes treatment, as the design specifies. */
const URGENT_MS = 60_000;

/** `mm:ss`, floored at zero. A negative remainder would be a suspended tab or a clock change. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** How long is left, or null when the vault is locked. */
function remainingMs(): number | null {
  const lockAt = getLockAt();
  return lockAt === null ? null : lockAt - Date.now();
}

export function LockCountdown() {
  /*
   * State holds the REMAINING time, not the deadline.
   *
   * Holding the deadline looks equivalent and is not: the deadline only changes when activity
   * resets the timer, so polling it set state to the same number every second, React bailed out
   * of re-rendering, and the chip froze at whatever `Date.now()` was on the last real render. It
   * then appeared to update only when the user interacted — the exact opposite of a countdown.
   */
  const [remaining, setRemaining] = useState<number | null>(() => remainingMs());

  useEffect(() => {
    const id = setInterval(() => setRemaining(remainingMs()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  if (remaining === null) return null;

  const urgent = remaining < URGENT_MS;

  return (
    <span
      role="timer"
      aria-live="off"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 11px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        background: urgent ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)',
        color: urgent ? 'var(--color-accent-700)' : 'var(--color-accent-2-800)',
      }}
    >
      <Icon icon={Timer} size={14} />
      Locks in {formatRemaining(remaining)}
    </span>
  );
}
