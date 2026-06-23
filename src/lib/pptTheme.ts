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

export interface SlideLine { cn: string; en: string; }

// Split paired lyrics into slides.
//  • If the main lyrics contain a BLANK LINE between content, each block of
//    lines (separated by blank lines) becomes ONE slide — so the user controls
//    exactly how many lines each page holds (page 1 = 4 lines, page 2 = 2…).
//  • Otherwise (no blank lines), fall back to a fixed `autoN` lines per slide.
// Translation lines pair with the Nth non-blank lyric line.
export function paginateLyrics(lyrics: string, english: string, autoN: number, pageLines?: number[]): SlideLine[][] {
  const rawLines = (lyrics || '').split('\n');
  const transLines = (english || '').split('\n').filter(l => l.trim().length > 0);

  // Explicit per-page line counts win over everything (the user set each page's
  // line count by hand). Page i takes pageLines[i] lines; the last value repeats
  // for any pages beyond the array.
  if (pageLines && pageLines.length) {
    const cn = rawLines.filter(l => l.trim().length > 0);
    const slides: SlideLine[][] = [];
    let i = 0, p = 0;
    while (i < cn.length) {
      const n = Math.max(1, Math.round(pageLines[Math.min(p, pageLines.length - 1)] || autoN));
      slides.push(cn.slice(i, i + n).map((c, k) => ({ cn: c, en: transLines[i + k] || '' })));
      i += n; p++;
    }
    return slides;
  }

  const hasBreaks = /\n[ \t]*\n/.test((lyrics || '').replace(/^\s+|\s+$/g, ''));

  if (hasBreaks) {
    const slides: SlideLine[][] = [];
    let cur: SlideLine[] = [];
    let ti = 0;
    for (const line of rawLines) {
      if (line.trim() === '') {
        if (cur.length) { slides.push(cur); cur = []; }
      } else {
        cur.push({ cn: line, en: transLines[ti] || '' });
        ti++;
      }
    }
    if (cur.length) slides.push(cur);
    return slides;
  }

  const cn = rawLines.filter(l => l.trim().length > 0);
  const n = Math.max(1, autoN);
  const slides: SlideLine[][] = [];
  for (let i = 0; i < cn.length; i += n) {
    slides.push(cn.slice(i, i + n).map((c, k) => ({ cn: c, en: transLines[i + k] || '' })));
  }
  return slides;
}

// Expand repeated sections (verse/chorus) so a repeating chorus is typed ONCE.
//   • Label a section with a [name] line on its own, e.g. [副歌] or [主歌1].
//   • The FIRST [name] line + the lines under it (until a blank line or the next
//     [marker]) DEFINE that section and are shown in place.
//   • Any LATER [name] line on its own (no lines under it) is replaced by that
//     section's lines — so "Verse1 / Chorus / Verse2 / Chorus" only needs the
//     chorus written once, and it appears at every repeat for the presenter.
// The English translation is paired to the Chinese by order and expanded in
// lockstep, so cn/en stay aligned. No markers → returned unchanged.
export function expandSongSections(lyrics: string, english: string): { lyrics: string; english: string } {
  if (!/^\s*\[[^\]]+\]\s*$/m.test(lyrics || '')) return { lyrics, english };

  const cnLines = (lyrics || '').split('\n');
  const enQueue = (english || '').split('\n').filter(l => l.trim().length > 0);
  let ei = 0;

  const isMarker = (l: string) => /^\s*\[[^\]]+\]\s*$/.test(l);
  const nameOf = (l: string) => l.trim().replace(/^\[|\]$/g, '').trim().toLowerCase();

  type Pair = { cn: string; en: string };
  const sections = new Map<string, Pair[]>();
  // output stream; `null` marks a section break (becomes a blank line)
  const out: (Pair | null)[] = [];
  let defining: string | null = null;

  for (const line of cnLines) {
    if (isMarker(line)) {
      const name = nameOf(line);
      out.push(null);
      if (sections.has(name)) {
        // reference → insert the section's lines
        for (const p of sections.get(name)!) out.push(p);
        out.push(null);
        defining = null;
      } else {
        sections.set(name, []);
        defining = name;
      }
    } else if (line.trim() === '') {
      out.push(null);
      defining = null;
    } else {
      const pair: Pair = { cn: line, en: enQueue[ei++] || '' };
      out.push(pair);
      if (defining) sections.get(defining)!.push(pair);
    }
  }

  // re-emit, collapsing consecutive breaks into a single blank line
  const cnOut: string[] = []; const enOut: string[] = [];
  let lastBlank = true;
  for (const item of out) {
    if (item === null) {
      if (!lastBlank) { cnOut.push(''); enOut.push(''); lastBlank = true; }
    } else {
      cnOut.push(item.cn); enOut.push(item.en); lastBlank = false;
    }
  }
  return { lyrics: cnOut.join('\n').trim(), english: enOut.join('\n').trim() };
}

// How heavy the drop shadow behind slide text is. Lets users dial readability
// up/down depending on how busy the background photo is.
export type ShadowLevel = 'light' | 'medium' | 'strong';

// Tuning per level — blur/offset/opacity for the .pptx, matched CSS for preview.
const SHADOW_LEVELS: Record<ShadowLevel, { blur: number; offset: number; opacity: number; css: string }> = {
  light:  { blur: 4,  offset: 2, opacity: 0.5,  css: '0 2px 4px rgba(0,0,0,0.5), 0 1px 1px rgba(0,0,0,0.4)' },
  medium: { blur: 8,  offset: 3, opacity: 0.75, css: '0 3px 8px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)' },
  strong: { blur: 15, offset: 5, opacity: 0.9,  css: '0 5px 14px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75)' },
};

// The pptxgenjs shadow object for a given level (angle 45°, soft blur — renders
// identically in PowerPoint/Keynote).
export function pptShadow(level: ShadowLevel = 'medium') {
  const m = SHADOW_LEVELS[level] || SHADOW_LEVELS.medium;
  return { type: 'outer' as const, color: '000000', angle: 45, blur: m.blur, offset: m.offset, opacity: m.opacity };
}

// The CSS text-shadow that mirrors pptShadow() for the on-screen preview.
export function previewShadow(level: ShadowLevel = 'medium'): string {
  return (SHADOW_LEVELS[level] || SHADOW_LEVELS.medium).css;
}

// Back-compat constants (medium) for callers that don't expose a level yet.
export const PPT_TEXT_SHADOW = pptShadow('medium');
export const PREVIEW_TEXT_SHADOW = previewShadow('medium');
