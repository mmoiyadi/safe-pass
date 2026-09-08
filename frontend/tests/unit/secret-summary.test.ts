/**
 * The row's fallbacks (FR-014a, FR-014b, FR-023a — CHK001, CHK002, CHK011).
 *
 * These were the three gaps most likely to bite in the first hour of building the list, which is
 * why they were settled in the spec before any of it was written. The tests are the record that
 * the decision actually reached the code.
 */
import { describe, expect, it } from 'vitest';
import type { TemplateVersionRecord } from '@pm/shared';
import {
  avatarInitial,
  firstSensitiveField,
  summaryValue,
} from '../../src/features/vault-list/secret-summary.js';

const template = (fields: Array<Partial<{ id: string; label: string; sensitive: boolean; order: number }>>) =>
  ({
    id: 'tv1',
    name: 'Test',
    fields: fields.map((f, i) => ({
      id: f.id ?? `f${i}`,
      label: f.label ?? `Field ${i}`,
      type: 'text',
      required: false,
      sensitive: f.sensitive ?? false,
      order: f.order ?? i,
    })),
  }) as unknown as TemplateVersionRecord;

/** The real built-in: one field, and it is sensitive. */
const SECURE_NOTE = template([{ id: 'body', label: 'Note', sensitive: true }]);

describe('the summary value (CHK001)', () => {
  it('uses the first non-sensitive field with a value', () => {
    const t = template([
      { id: 'url', label: 'Website' },
      { id: 'username', label: 'Username' },
    ]);
    expect(summaryValue({ fields: { url: 'example.com', username: 'alice' }, custom: [] }, t)).toBe(
      'example.com',
    );
  });

  it('respects declared field order, not object key order', () => {
    const t = template([
      { id: 'second', order: 1 },
      { id: 'first', order: 0 },
    ]);
    expect(summaryValue({ fields: { second: 'B', first: 'A' }, custom: [] }, t)).toBe('A');
  });

  it('skips sensitive fields entirely', () => {
    const t = template([{ id: 'pw', sensitive: true }, { id: 'user' }]);
    expect(summaryValue({ fields: { pw: 'hunter2', user: 'alice' }, custom: [] }, t)).toBe('alice');
  });

  it('skips non-sensitive fields that are empty', () => {
    const t = template([{ id: 'url' }, { id: 'user' }]);
    expect(summaryValue({ fields: { url: '', user: 'alice' }, custom: [] }, t)).toBe('alice');
  });

  it('returns null for Secure Note, whose only field is sensitive', () => {
    expect(summaryValue({ fields: { body: 'a private note' }, custom: [] }, SECURE_NOTE)).toBeNull();
  });

  it('falls back to a non-sensitive custom field', () => {
    expect(
      summaryValue(
        {
          fields: { body: 'note' },
          custom: [{ id: 'c1', label: 'Where', value: 'top drawer', sensitive: false }],
        },
        SECURE_NOTE,
      ),
    ).toBe('top drawer');
  });

  it('does not fall back to a SENSITIVE custom field', () => {
    expect(
      summaryValue(
        {
          fields: { body: 'note' },
          custom: [{ id: 'c1', label: 'Recovery', value: 'secret', sensitive: true }],
        },
        SECURE_NOTE,
      ),
    ).toBeNull();
  });

  it('returns null when every field is empty', () => {
    const t = template([{ id: 'url' }, { id: 'user' }]);
    expect(summaryValue({ fields: { url: '', user: '' }, custom: [] }, t)).toBeNull();
  });

  it('returns null when the template could not be resolved', () => {
    expect(summaryValue({ fields: { a: 'x' }, custom: [] }, undefined)).toBeNull();
  });
});

describe('the quick-copy field (CHK002)', () => {
  it('picks the first sensitive field with a value', () => {
    const t = template([{ id: 'user' }, { id: 'pw', label: 'Password', sensitive: true }]);
    expect(firstSensitiveField({ fields: { user: 'alice', pw: 'hunter2' }, custom: [] }, t)).toEqual({
      label: 'Password',
      value: 'hunter2',
    });
  });

  it('returns null when the secret has no sensitive field at all', () => {
    const t = template([{ id: 'user' }, { id: 'url' }]);
    expect(firstSensitiveField({ fields: { user: 'alice', url: 'x' }, custom: [] }, t)).toBeNull();
  });

  it('returns null when the only sensitive field is empty — nothing to copy', () => {
    expect(firstSensitiveField({ fields: { body: '' }, custom: [] }, SECURE_NOTE)).toBeNull();
  });

  it('never falls back to a non-sensitive value', () => {
    const t = template([{ id: 'user' }, { id: 'pw', sensitive: true }]);
    expect(firstSensitiveField({ fields: { user: 'alice', pw: '' }, custom: [] }, t)).toBeNull();
  });

  it('finds a sensitive custom field when the template has none', () => {
    const t = template([{ id: 'user' }]);
    expect(
      firstSensitiveField(
        { fields: { user: 'alice' }, custom: [{ id: 'c1', label: 'Recovery', value: 'phrase', sensitive: true }] },
        t,
      ),
    ).toEqual({ label: 'Recovery', value: 'phrase' });
  });
});

describe('the avatar initial (CHK011)', () => {
  it('uppercases a Latin letter', () => {
    expect(avatarInitial('github')).toBe('G');
  });

  it('leaves an already-uppercase letter alone', () => {
    expect(avatarInitial('GitHub')).toBe('G');
  });

  it('keeps an emoji whole rather than splitting a surrogate pair', () => {
    expect(avatarInitial('🔐 vault key')).toBe('🔐');
  });

  it('keeps a combining accent attached to its base letter', () => {
    expect(avatarInitial('Ångström')).toBe('Å');
  });

  it('passes through a script with no case, unchanged', () => {
    expect(avatarInitial('ジム会員証')).toBe('ジ');
  });

  it('uses a digit or symbol as-is', () => {
    expect(avatarInitial('1Password')).toBe('1');
    expect(avatarInitial('@home')).toBe('@');
  });

  it('renders no character for an empty title', () => {
    expect(avatarInitial('')).toBe('');
  });

  it('renders no character when the title begins with whitespace', () => {
    expect(avatarInitial('  padded')).toBe('');
  });
});
