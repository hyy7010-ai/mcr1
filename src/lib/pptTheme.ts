// ── Shared PPT slide theming helpers ──────────────────────────────────────────
// Keeps the on-screen preview and the downloaded .pptx visually identical:
//   • text color auto-adapts to the background (dark text on light, light on dark)
//   • image backgrounds get a dark overlay so any photo stays readable
//   • a consistent text shadow definition is used everywhere

// Relative luminance (0 = black, 1 = white) of a hex color like "#064E3B" or "064E3B".
export function hexLuminance(hex: string): number {
  const c = (hex || '').replace('#', '').trim();
  if (c.length < 6) return 0; // unknown → treat as dark
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export interface SlideColors {
  /** lyric (primary) text color, with leading # */
  lc: string;
  /** translation (secondary) text color, with leading # */
  tc: string;
  /** whether a dark readability overlay should be drawn over the background */
  overlay: boolean;
}

// Decide the text colors + overlay for a given background.
//  - Image backgrounds: keep the user's chosen colors and add a dark overlay
//    (photos can be bright/busy, the overlay guarantees the text reads).
//  - Light solid colors: force dark text so it doesn't vanish into the bg.
//  - Dark solid colors: respect the user's chosen colors as-is.
export function resolveSlideColors(
  bg: { url?: string | null; color?: string | null } | null | undefined,
  userLyricColor: string,
  userTranslationColor: string,
): SlideColors {
  if (bg?.url) {
    return { lc: userLyricColor, tc: userTranslationColor, overlay: true };
  }
  const lum = hexLuminance(bg?.color || '064E3B');
  if (lum > 0.6) {
    // light background → dark, readable text
    return { lc: '#111111', tc: '#374151', overlay: false };
  }
  return { lc: userLyricColor, tc: userTranslationColor, overlay: false };
}

// Strong, consistent shadow used for every PPT text block so the words lift off
// the background. (angle 45°, soft blur — renders identically in PowerPoint/Keynote.)
export const PPT_TEXT_SHADOW = {
  type: 'outer' as const,
  color: '000000',
  blur: 8,
  offset: 3,
  angle: 45,
  opacity: 0.75,
};

// The CSS text-shadow that mirrors PPT_TEXT_SHADOW for the on-screen preview.
export const PREVIEW_TEXT_SHADOW = '0 3px 8px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)';
