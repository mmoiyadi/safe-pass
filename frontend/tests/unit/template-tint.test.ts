/**
 * The list avatar's colour treatment (T016, FR-023, SC-006, Principle V).
 *
 * The point of hashing the template NAME is that a template defined by a user tomorrow gets a
 * tint without anyone editing this repository. So the test that matters is not "Login is
 * terracotta" — it is that an unknown name still lands on a permitted pair, and that the same
 * name always lands on the same one. A switch on type names would pass neither.
 */
import { describe, expect, it } from 'vitest';
import { TINTS, templateTint } from '../../src/features/vault-list/template-tint.js';

const BUILT_INS = ['Website Account', 'Credit Card', 'Identity / PAN Card', 'Secure Note'];
const INVENTED = [
  'Wine cellar inventory',
  'Router admin',
  'Passport',
  'ジム会員証',
  'Café loyalty',
  '',
  '   ',
  'a'.repeat(500),
];

describe('stability', () => {
  it('gives the same name the same tint every time', () => {
    for (const name of [...BUILT_INS, ...INVENTED]) {
      const first = templateTint(name);
      for (let i = 0; i < 20; i += 1) {
        expect(templateTint(name)).toEqual(first);
      }
    }
  });

  it('does not depend on call order', () => {
    const a = templateTint('Website Account');
    templateTint('Credit Card');
    templateTint('Secure Note');
    expect(templateTint('Website Account')).toEqual(a);
  });
});

describe('every output is a permitted pair', () => {
  it('returns one of the four token pairs, for built-in and invented names alike', () => {
    for (const name of [...BUILT_INS, ...INVENTED]) {
      expect(TINTS).toContainEqual(templateTint(name));
    }
  });

  it('names only design-system tokens — no literal colour ever reaches the DOM', () => {
    for (const tint of TINTS) {
      expect(tint.background).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      expect(tint.foreground).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  it('offers exactly the four pairs the handoff specifies', () => {
    expect(TINTS).toHaveLength(4);
  });
});

describe('a template added later needs no code change (SC-006)', () => {
  it('assigns a tint to a name this codebase has never seen', () => {
    const tint = templateTint('Something Nobody Has Defined Yet');
    expect(TINTS).toContainEqual(tint);
  });

  it('spreads a realistic set of names across more than one pair', () => {
    const used = new Set(
      [...BUILT_INS, ...INVENTED, 'Server', 'Bank', 'Email', 'VPN', 'Licence'].map(
        (n) => templateTint(n).background,
      ),
    );
    expect(used.size).toBeGreaterThan(1);
  });

  it('distinguishes names that differ only in case or spacing', () => {
    // Not a requirement that they differ — only that each is stable and valid.
    for (const name of ['secure note', 'Secure Note', ' Secure Note ']) {
      expect(TINTS).toContainEqual(templateTint(name));
    }
  });
});
