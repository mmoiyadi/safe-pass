/**
 * Characterisation of CopyButton (T011, FR-004/FR-052, Principle IV).
 *
 * Written against the CURRENT, UNMODIFIED component and run before the redesign restyles it
 * (T048). Three text states carry meaning here, not the two the handoff mentions: the countdown
 * while copied, the confirmation once cleared, and the refusal. All three are pinned.
 *
 * The conditional overwrite is the subtle one: the clipboard is only emptied if it still holds
 * OUR value, because clobbering whatever the user copied since would be worse than leaving it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyButton } from '../../src/components/CopyButton.js';

const writeText = vi.fn<(v: string) => Promise<void>>();
const readText = vi.fn<() => Promise<string>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  readText.mockReset().mockResolvedValue('');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let the clipboard promise chain settle while timers are faked. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickCopy(name = 'Copy Password') {
  fireEvent.click(screen.getByRole('button', { name }));
  await settle();
}

describe('copying', () => {
  it('writes the value to the clipboard', async () => {
    render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith('hunter2');
  });

  it('labels the control "Copy {label}"', () => {
    render(<CopyButton value="v" label="Card number" />);
    expect(screen.getByRole('button', { name: 'Copy Card number' })).toBeTruthy();
  });
});

describe('the countdown', () => {
  it('announces a 30-second clearance immediately after copying', async () => {
    const { container } = render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();
    expect(container.textContent).toContain('copied — clipboard clears in 30s');
  });

  it('ticks down once a second', async () => {
    const { container } = render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain('copied — clipboard clears in 29s');

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.textContent).toContain('copied — clipboard clears in 25s');
  });
});

describe('clearing after 30 seconds', () => {
  it('empties the clipboard and confirms, when it still holds our value', async () => {
    readText.mockResolvedValue('hunter2');
    const { container } = render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await settle();

    expect(writeText).toHaveBeenCalledWith('');
    expect(container.textContent).toContain('clipboard cleared');
  });

  it('does NOT overwrite a clipboard the user has since changed', async () => {
    readText.mockResolvedValue('something the user copied afterwards');
    render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await settle();

    expect(writeText).toHaveBeenCalledTimes(1); // the original copy only
    expect(writeText).not.toHaveBeenCalledWith('');
  });

  it('does not clear early', async () => {
    readText.mockResolvedValue('hunter2');
    const { container } = render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();

    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    await settle();
    expect(container.textContent).not.toContain('clipboard cleared');
  });
});

describe('a refused clipboard', () => {
  it('says the browser refused rather than claiming a copy that did not happen', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { container } = render(<CopyButton value="hunter2" label="Password" />);
    await clickCopy();

    expect(container.textContent).toContain('the browser refused clipboard access');
    expect(container.textContent).not.toContain('copied — clipboard clears');
  });
});
