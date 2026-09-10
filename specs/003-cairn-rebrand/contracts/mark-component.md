# Contract: `components/Mark.tsx`

The only module in the application that knows the mark's shape (FR-009). Everything else asks for
a mark at a size and gets the right one.

---

## Interface

```ts
export function Mark({ size = 24 }: { size?: number }): JSX.Element;
```

That is the whole surface. No colour prop, no variant prop, no class name.

**No colour prop** because the mark takes its colour from its surroundings (FR-007): every shape
is `fill="currentColor"`, so a caller sets `color` in CSS and the mark follows. One asset serves
the cream ground, the terracotta tile and anything later.

**No variant prop** because the variant is a function of the size (FR-006) and a caller who could
choose would eventually choose wrong — a two-stone mark at 64px, or a four-stone mark at 14px.

---

## Variant selection

| Size | Variant | Stones |
|---|---|---|
| `< 20` | micro | 2 |
| `20` to `< 32` | small | 3 |
| `>= 32` | full | 4 |

Boundaries are inclusive at the lower end: exactly 20 is small, exactly 32 is full.

---

## Geometry

All three: `viewBox="0 0 48 48"`, every ellipse `fill="currentColor"`, rendered at `width={size}
height={size}`.

Transcribed rather than imported — the source SVGs are 94% C2PA provenance metadata (research §1).

### Full — 32px and up

```
cx=24    cy=38     rx=13     ry=4.6
cx=23    cy=28.4   rx=10     ry=4.2    opacity=0.62
cx=25    cy=20     rx=7      ry=3.8
cx=23    cy=12.2   rx=3.75   ry=3.6    opacity=0.62
```

### Small — 20 to 31px

```
cx=24    cy=38     rx=13.5   ry=5.2
cx=22.4  cy=27.4   rx=9.6    ry=4.8
cx=25    cy=16.6   rx=5.4    ry=4.6
```

### Micro — below 20px

```
cx=24    cy=36     rx=15     ry=6.6
cx=23    cy=20     rx=8.6    ry=6.4
```

**The alternating opacity exists only in the full mark.** Small and micro are flat, because at
those sizes a 62% stone reads as a rendering fault rather than a design choice.

**The `cx` values are not typos and must not be tidied.** 24, 23, 25, 23 — the stones are
deliberately off-centre, and FR-011 forbids centring them. A helpful clean-up here is a silent
change to the brand.

---

## Accessibility

The mark is decorative wherever it appears: the rail lockup sets the word "Cairn" beside it in
text, and the browser tab and installed app carry their own names. It therefore renders
`aria-hidden` and contributes no accessible name, exactly as `Icon.tsx` does — the same reasoning
and the same treatment.

---

## The rail lockup

The one place in the interface that uses the icon form (FR-010). Everywhere else the word alone
stands.

- A 34px tile, corner radius 11, filled `var(--color-accent)`
- The mark at 20px inside it, coloured `var(--color-bg)` so it reads as cream on terracotta
- The word "Cairn" beside it in `var(--font-heading)` at 19px
- 10px between tile and word

Clear space (FR-011) is satisfied with room to spare: the rule requires 3.0px at this scale and
the tile gives 9.3–11.6px on each side (research §3).

This replaces the `Shield` icon and the words "Password Manager" currently in `VaultRail.tsx`'s
`Brand()`. The `Shield` import goes with it.

---

## What this contract forbids

- Importing the SVG files at runtime — fails FR-008 and drags the metadata along
- A second module referencing the mark's shape — fails FR-009
- Outline, gradient, bevel or shadow; non-square scaling; centred stones — fails FR-011
- Giving the mark its own colour rather than inheriting — fails FR-007
