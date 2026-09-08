/**
 * Characterisation of SensitiveField (T010, FR-003/FR-041, Principle IV).
 *
 * Written against the CURRENT, UNMODIFIED component and run before the redesign restyles it
 * (T047). The restyle turns the text button into a 32px round icon button; every assertion here
 * must still pass afterwards, unchanged. If one needs editing, the restyle changed behaviour.
 *
 * Pinned: the fixed 12-bullet mask that withholds the real length, the 30-second auto-re-hide,
 * and both accessible-label forms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SensitiveField } from '../../src/components/SensitiveField.js';

const MASK = '•'.repeat(12);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the mask', () => {
  it('masks by default', () => {
    render(<SensitiveField value="hunter2" label="Password" />);
    expect(screen.getByText(MASK)).toBeTruthy();
    expect(screen.queryByText('hunter2')).toBeNull();
  });

  it('is exactly twelve bullets', () => {
    render(<SensitiveField value="x" label="Password" />);
    expect(screen.getByText(MASK).textContent).toHaveLength(12);
  });

  it('does not reveal the value length — a short and a long value mask identically', () => {
    const { unmount } = render(<SensitiveField value="a" label="Password" />);
    const short = screen.getByText(MASK).textContent;
    unmount();

    render(<SensitiveField value="a-very-much-longer-passphrase" label="Password" />);
    expect(screen.getByText(MASK).textContent).toBe(short);
  });
});

describe('reveal and re-hide', () => {
  it('reveals the value when the control is used', () => {
    render(<SensitiveField value="hunter2" label="Password" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Password' }));
    expect(screen.getByText('hunter2')).toBeTruthy();
  });

  it('re-hides itself automatically after 30 seconds', () => {
    render(<SensitiveField value="hunter2" label="Password" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Password' }));
    expect(screen.getByText('hunter2')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(screen.getByText('hunter2')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('hunter2')).toBeNull();
    expect(screen.getByText(MASK)).toBeTruthy();
  });

  it('can be hidden manually before the timer fires', () => {
    render(<SensitiveField value="hunter2" label="Password" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Password' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(screen.queryByText('hunter2')).toBeNull();
  });
});

describe('accessible labels', () => {
  it('reads "Reveal {label}" while masked', () => {
    render(<SensitiveField value="v" label="Card number" />);
    expect(screen.getByRole('button', { name: 'Reveal Card number' })).toBeTruthy();
  });

  it('reads "Hide {label}" while revealed', () => {
    render(<SensitiveField value="v" label="Card number" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Card number' }));
    expect(screen.getByRole('button', { name: 'Hide Card number' })).toBeTruthy();
  });
});
