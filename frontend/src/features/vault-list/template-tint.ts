/**
 * A secret's colour treatment in the list, derived from its template name (T017, FR-023).
 *
 * Deliberately a hash and not a lookup. Secret types are data, not code (Principle V), so a
 * template a user defines tomorrow must receive a treatment without anyone editing this file.
 * Switching on 'Website Account' | 'Credit Card' | ... would put the type system back in the
 * code the constitution took it out of, and would leave every custom template untinted.
 *
 * FNV-1a is chosen for being tiny, dependency-free and stable across runs and machines — the
 * same name must tint identically in every session, or a list would reshuffle its colours on
 * reload. It is not a security primitive and nothing here depends on it resisting collision:
 * two templates sharing a tint is a cosmetic coincidence, not a defect.
 */

/** The four pairs the design defines. Background first, then the glyph drawn on it. */
export const TINTS = [
  { background: 'var(--color-accent-200)', foreground: 'var(--color-accent-700)' },
  { background: 'var(--color-accent-2-200)', foreground: 'var(--color-accent-2-800)' },
  { background: 'var(--color-neutral-200)', foreground: 'var(--color-neutral-800)' },
  { background: 'var(--color-neutral-300)', foreground: 'var(--color-neutral-900)' },
] as const;

export type Tint = (typeof TINTS)[number];

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply in 32-bit space. Math.imul keeps this exact where `*` would lose precision.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Coerce to unsigned so the modulo below cannot return a negative index.
  return hash >>> 0;
}

export function templateTint(templateName: string): Tint {
  // The modulo cannot fall outside the array, so the assertion states an invariant the
  // type system cannot see rather than papering over an unchecked case.
  return TINTS[fnv1a(templateName) % TINTS.length]!;
}
