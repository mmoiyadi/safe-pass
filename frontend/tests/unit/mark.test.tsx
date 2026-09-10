/**
 * The mark (T006, FR-006, FR-007, FR-011).
 *
 * The mark is designed to lose stones as it shrinks rather than shrink its stones, so the
 * thresholds are behaviour, not styling — a four-stone mark in a 16px browser tab is mud, and
 * mud in a browser tab is the one place a user scans fastest.
 *
 * The offsets are pinned too. The stones are deliberately off-centre and FR-011 forbids centring
 * them; a well-meaning tidy-up would be a silent change to the brand, and nothing else in the
 * codebase would notice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Mark } from '../../src/components/Mark.js';

afterEach(cleanup);

const stones = (size: number): SVGEllipseElement[] => {
  const { container } = render(<Mark size={size} />);
  return [...container.querySelectorAll('ellipse')];
};

describe('variant selection by size (FR-006)', () => {
  it('shows two stones below 20px', () => {
    expect(stones(16)).toHaveLength(2);
    expect(stones(19)).toHaveLength(2);
  });

  it('shows three stones from 20px up to 31px', () => {
    expect(stones(20)).toHaveLength(3);
    expect(stones(24)).toHaveLength(3);
    expect(stones(31)).toHaveLength(3);
  });

  it('shows four stones from 32px up', () => {
    expect(stones(32)).toHaveLength(4);
    expect(stones(64)).toHaveLength(4);
    expect(stones(512)).toHaveLength(4);
  });

  it('defaults to a size that yields the three-stone mark', () => {
    const { container } = render(<Mark />);
    expect(container.querySelectorAll('ellipse')).toHaveLength(3);
  });
});

describe('colour comes from the surroundings (FR-007)', () => {
  it('fills every shape with currentColor, at every size', () => {
    for (const size of [16, 24, 48]) {
      for (const stone of stones(size)) {
        expect(stone.getAttribute('fill')).toBe('currentColor');
      }
    }
  });
});

describe('geometry is exactly as drawn (FR-011)', () => {
  it('keeps the stones off-centre — 24, 23, 25, 23 in the full mark', () => {
    expect(stones(48).map((s) => s.getAttribute('cx'))).toEqual(['24', '23', '25', '23']);
  });

  it('alternates weight only in the full mark', () => {
    const full = stones(48).map((s) => s.getAttribute('opacity'));
    expect(full).toEqual([null, '0.62', null, '0.62']);

    // Below 32px a 62% stone reads as a rendering fault rather than a design.
    for (const size of [16, 24]) {
      for (const stone of stones(size)) {
        expect(stone.getAttribute('opacity')).toBeNull();
      }
    }
  });

  it('scales squarely on a 48-unit grid', () => {
    const { container } = render(<Mark size={40} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(svg.getAttribute('width')).toBe('40');
    expect(svg.getAttribute('height')).toBe('40');
  });
});

describe('accessibility', () => {
  it('is decorative — the word beside it carries the name', () => {
    const { container } = render(<Mark size={24} />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
