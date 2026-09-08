/**
 * The detail footer's timestamp (FR-030e, CHK013).
 */
import { describe, expect, it } from 'vitest';
import { relativeUpdated } from '../../src/features/secret-detail/relative-time.js';

const NOW = Date.parse('2026-09-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('thresholds', () => {
  it('says "just now" under a minute', () => {
    expect(relativeUpdated(ago(0), NOW)).toBe('just now');
    expect(relativeUpdated(ago(59_000), NOW)).toBe('just now');
  });

  it('counts whole minutes under an hour', () => {
    expect(relativeUpdated(ago(60_000), NOW)).toBe('1 minute ago');
    expect(relativeUpdated(ago(90_000), NOW)).toBe('1 minute ago');
    expect(relativeUpdated(ago(45 * 60_000), NOW)).toBe('45 minutes ago');
  });

  it('counts whole hours under a day', () => {
    expect(relativeUpdated(ago(3_600_000), NOW)).toBe('1 hour ago');
    expect(relativeUpdated(ago(23 * 3_600_000), NOW)).toBe('23 hours ago');
  });

  it('counts whole days under a week', () => {
    expect(relativeUpdated(ago(24 * 3_600_000), NOW)).toBe('1 day ago');
    expect(relativeUpdated(ago(6 * 24 * 3_600_000), NOW)).toBe('6 days ago');
  });

  it('hands over to an absolute date from a week onward', () => {
    const result = relativeUpdated(ago(7 * 24 * 3_600_000), NOW);
    expect(result).not.toMatch(/ago/);
    expect(result).toMatch(/2026/);
  });
});

describe('edge values', () => {
  it('treats a future timestamp as "just now" rather than negative time', () => {
    expect(relativeUpdated(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('returns an empty string for an unparseable value rather than "NaN ago"', () => {
    expect(relativeUpdated('not a date', NOW)).toBe('');
  });
});
