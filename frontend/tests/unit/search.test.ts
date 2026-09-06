/**
 * Search behaviour and scale (T073).
 *
 * SC-003: a 5,000-secret vault must return results in under 1 second at p95.
 */
import { describe, expect, it } from 'vitest';
import { SearchIndex, type Indexable } from '../../src/search/index.js';

const item = (over: Partial<Indexable> & { id: string; title: string }): Indexable => ({
  searchableFields: {},
  folderName: null,
  tagNames: [],
  templateName: 'Website Account',
  ...over,
});

describe('ranking', () => {
  const index = new SearchIndex();
  index.build([
    item({ id: 'a', title: 'GitHub' }),
    item({ id: 'b', title: 'My GitHub backup codes' }),
    item({ id: 'c', title: 'Notes', searchableFields: { body: 'migrated from github in 2021' } }),
    item({ id: 'd', title: 'Bank', tagNames: ['github-sponsors'] }),
  ]);

  it('ranks a title prefix above a mid-title match, and both above a field match', () => {
    const ids = index.search('github').map((h) => h.id);
    expect(ids[0]).toBe('a');
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
    expect(ids).toContain('d');
  });

  it('reports where the match came from', () => {
    const hits = index.search('github');
    expect(hits.find((h) => h.id === 'a')?.matchedIn).toBe('title');
    expect(hits.find((h) => h.id === 'c')?.matchedIn).toBe('field');
  });

  it('requires every term to match, so adding a word narrows rather than widens', () => {
    expect(index.search('github').length).toBeGreaterThan(1);
    expect(index.search('github backup').map((h) => h.id)).toEqual(['b']);
    expect(index.search('github nonexistentword')).toHaveLength(0);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(index.search('  GITHUB  ').map((h) => h.id)).toContain('a');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(index.search('')).toHaveLength(0);
    expect(index.search('   ')).toHaveLength(0);
  });

  it('orders ties stably', () => {
    expect(index.search('github').map((h) => h.id)).toEqual(index.search('github').map((h) => h.id));
  });
});

describe('folders, tags and types are searchable', () => {
  const index = new SearchIndex();
  index.build([
    item({
      id: 'x',
      title: 'Anonymous',
      folderName: 'Household',
      tagNames: ['utilities', 'shared'],
    }),
  ]);

  it('matches a folder name', () => {
    expect(index.search('household').map((h) => h.id)).toEqual(['x']);
  });

  it('matches a tag name', () => {
    expect(index.search('utilities')[0]?.matchedIn).toBe('tag');
  });

  it('matches a template name', () => {
    expect(index.search('website')[0]?.matchedIn).toBe('type');
  });
});

describe('the index is discardable', () => {
  it('clears completely, so a lock leaves nothing searchable', () => {
    const index = new SearchIndex();
    index.build([item({ id: 'a', title: 'GitHub' })]);
    expect(index.search('github')).toHaveLength(1);

    index.clear();

    expect(index.size).toBe(0);
    expect(index.search('github')).toHaveLength(0);
  });
});

describe('scale — SC-003', () => {
  it('searches 5,000 secrets well inside the 1s p95 budget', () => {
    const index = new SearchIndex();
    index.build(
      Array.from({ length: 5000 }, (_, i) =>
        item({
          id: `s${i}`,
          title: `Account number ${i} at provider ${i % 97}`,
          searchableFields: {
            username: `user${i}@example.com`,
            url: `https://site${i % 313}.example`,
          },
          folderName: `Folder ${i % 40}`,
          tagNames: [`tag${i % 25}`, `tag${i % 7}`],
        }),
      ),
    );
    expect(index.size).toBe(5000);

    const durations: number[] = [];
    for (const q of ['provider 42', 'user4999', 'site200', 'tag13', 'folder 39', 'account', 'zzz']) {
      for (let run = 0; run < 30; run++) {
        const started = performance.now();
        index.search(q);
        durations.push(performance.now() - started);
      }
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(1000);
    // Far below the budget in practice. This second bound guards against a regression to
    // something pathological, rather than against the stated target being missed by a hair.
    expect(p95).toBeLessThan(100);
  });

  it('builds a 5,000-item index quickly enough to run on every unlock', () => {
    const items = Array.from({ length: 5000 }, (_, i) =>
      item({ id: `s${i}`, title: `Secret ${i}`, searchableFields: { u: `user${i}` } }),
    );
    const index = new SearchIndex();
    const started = performance.now();
    index.build(items);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
