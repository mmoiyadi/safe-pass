/**
 * The per-secret custom-field codec (T120, FR-039).
 *
 * Two properties matter. The set must survive a round trip exactly, because these are the only
 * copy of whatever the user typed. And decoding must never throw: it runs while rendering a
 * secret, so a blob that cannot be parsed has to cost the user those extra fields, not the
 * whole secret.
 */
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELDS_KEY,
  decodeCustomFields,
  encodeCustomFields,
  type CustomField,
} from '../../src/features/secret-detail/CustomFields.js';

const field = (over: Partial<CustomField> = {}): CustomField => ({
  id: 'c1',
  label: 'Recovery phrase',
  value: 'correct horse battery staple',
  sensitive: true,
  ...over,
});

describe('round trip', () => {
  it('returns exactly what went in', () => {
    const fields = [field(), field({ id: 'c2', label: 'Branch', value: 'Pune', sensitive: false })];
    expect(decodeCustomFields(encodeCustomFields(fields)!)).toEqual(fields);
  });

  it('packs everything into ONE string, so one envelope holds the whole set', () => {
    const packed = encodeCustomFields([field(), field({ id: 'c2' })]);
    expect(typeof packed).toBe('string');
  });

  it('survives values that would break a naive delimiter format', () => {
    const awkward = field({ value: 'a,b\n"c"\t{"d":1} \\ ' + String.fromCharCode(0), label: 'a:b=c' });
    expect(decodeCustomFields(encodeCustomFields([awkward])!)).toEqual([awkward]);
  });

  it('keeps unicode intact', () => {
    const f = field({ label: 'पासवर्ड', value: '🔐 naïve café' });
    expect(decodeCustomFields(encodeCustomFields([f])!)).toEqual([f]);
  });
});

describe('nothing worth storing', () => {
  it('encodes an empty set as null, so no envelope is written at all', () => {
    expect(encodeCustomFields([])).toBeNull();
  });

  it('drops a row the user added and left completely blank', () => {
    expect(encodeCustomFields([{ id: 'c1', label: '   ', value: '', sensitive: false }])).toBeNull();
  });

  it('keeps a labelled field whose value is still empty', () => {
    const packed = encodeCustomFields([{ id: 'c1', label: 'Later', value: '', sensitive: false }]);
    expect(decodeCustomFields(packed!)).toHaveLength(1);
  });
});

describe('decoding never throws', () => {
  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not JSON', '{oh no'],
    ['JSON, but not an array', '{"label":"x"}'],
    ['an array of junk', '[1,"two",null]'],
  ])('yields an empty set for %s', (_name, input) => {
    expect(decodeCustomFields(input as string | undefined)).toEqual([]);
  });

  it('fills in what a partial entry is missing rather than dropping it', () => {
    const [only] = decodeCustomFields('[{"label":"Note"}]');
    expect(only).toEqual({ id: 'c0', label: 'Note', value: '', sensitive: false });
  });

  it('treats a non-boolean `sensitive` as not sensitive rather than as truthy', () => {
    // Getting this backwards would unmask a value the user had hidden.
    expect(decodeCustomFields('[{"label":"a","sensitive":"false"}]')[0]!.sensitive).toBe(false);
  });
});

describe('the reserved key', () => {
  it('cannot collide with a slug the template editor generates', () => {
    // The editor slugs labels to [a-z0-9_] with leading underscores stripped, so a
    // double-underscore prefix is unreachable from any label a user could type.
    const slug = (label: string) =>
      label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    for (const attempt of ['__custom', '_ _custom', 'custom', '  __CUSTOM  ']) {
      expect(slug(attempt)).not.toBe(CUSTOM_FIELDS_KEY);
    }
  });
});
