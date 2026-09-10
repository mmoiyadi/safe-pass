/**
 * The Cairn mark (T007, FR-006 to FR-011).
 *
 * The only module that knows the mark's shape. Everything else asks for a mark at a size and gets
 * the right one — which is what lets the rule "drop a stone as it shrinks" be honoured everywhere
 * rather than remembered at each call site.
 *
 * The geometry is transcribed from the handoff's SVGs rather than importing them. Each of those
 * files is roughly 8 KB, of which 7,736 bytes is a C2PA provenance manifest describing how the
 * file was authored — meaningful for the file, meaningless once the shapes are React elements.
 * Importing them would either cost four requests, which defeats being present at first paint
 * (FR-008), or embed ~23 KB of base64 in a component that renders on every screen.
 *
 * The stones are deliberately off-centre. FR-011 forbids centring them: the -1 / +1 / -1 offsets
 * ARE the mark, and tidying `cx` into a column would be a silent change to the brand.
 */

/** Two, three or four stones, chosen by size. Boundaries are inclusive at the lower end. */
const MICRO_BELOW = 20;
const FULL_FROM = 32;

interface Stone {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Alternating weight, in the full mark only. */
  faded?: boolean;
}

/** Four stones, alternating weight. 32px and up, where the shading reads as intended. */
const FULL: Stone[] = [
  { cx: 24, cy: 38, rx: 13, ry: 4.6 },
  { cx: 23, cy: 28.4, rx: 10, ry: 4.2, faded: true },
  { cx: 25, cy: 20, rx: 7, ry: 3.8 },
  { cx: 23, cy: 12.2, rx: 3.75, ry: 3.6, faded: true },
];

/** Three stones, flat. 20-31px: at this size a 62% stone reads as a rendering fault. */
const SMALL: Stone[] = [
  { cx: 24, cy: 38, rx: 13.5, ry: 5.2 },
  { cx: 22.4, cy: 27.4, rx: 9.6, ry: 4.8 },
  { cx: 25, cy: 16.6, rx: 5.4, ry: 4.6 },
];

/** Two stones, larger and rounder. Below 20px, where three would merge. */
const MICRO: Stone[] = [
  { cx: 24, cy: 36, rx: 15, ry: 6.6 },
  { cx: 23, cy: 20, rx: 8.6, ry: 6.4 },
];

function stonesFor(size: number): Stone[] {
  if (size < MICRO_BELOW) return MICRO;
  if (size < FULL_FROM) return SMALL;
  return FULL;
}

/**
 * Decorative everywhere it appears: the rail sets the word "Cairn" beside it, and the browser tab
 * and installed app carry their own names. It therefore contributes no accessible name, exactly
 * as `Icon.tsx` does.
 *
 * `fill="currentColor"` on every stone, so one asset serves the cream ground and the terracotta
 * tile alike (FR-007) — colour is the caller's business, set in CSS.
 */
export function Mark({ size = 24, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      focusable={false}
      style={{ flexShrink: 0, ...style }}
    >
      {stonesFor(size).map((stone) => (
        <ellipse
          key={`${stone.cx}-${stone.cy}`}
          cx={stone.cx}
          cy={stone.cy}
          rx={stone.rx}
          ry={stone.ry}
          fill="currentColor"
          {...(stone.faded ? { opacity: 0.62 } : {})}
        />
      ))}
    </svg>
  );
}
