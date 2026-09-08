/**
 * The one place an icon is rendered (T015, FR-022c).
 *
 * Two properties are fixed here rather than left to each call site. Stroke width is 2.75 across
 * the whole interface — the Organic system's weight — and a glyph is always `aria-hidden`,
 * because every icon in this design sits beside a label or inside a control that already carries
 * its own accessible name (FR-025). An icon that announced itself would double every button.
 *
 * The icon component is passed in rather than named by string, so each screen imports only the
 * glyphs it uses and the rest are never bundled.
 */
import type { LucideIcon } from 'lucide-react';

export const ICON_STROKE_WIDTH = 2.75;

export function Icon({
  icon: Glyph,
  size = 16,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={ICON_STROKE_WIDTH}
      aria-hidden
      focusable={false}
      style={{ flexShrink: 0, ...style }}
    />
  );
}
