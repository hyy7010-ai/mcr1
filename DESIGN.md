# GraceFlow — Design System (DESIGN.md)

## Theme
Light, warm-paper. One ink, taupe secondaries, color reserved for meaning. Defined as Tailwind v4 `@theme` tokens in `src/index.css`.

## Color (tokens, not hex, in code)
- **Body / surface**: `surface` `#F4F1EE` (warm paper), `surface-container` `#fff`, `surface-container-low` `#F9F7F5`, `surface-dim`/`-high` `#E5E0DA`.
- **Ink**: `on-surface` `#2C2C2C`. **Muted**: `on-surface-variant` / `outline` `#8B7E74` (use only for ≥14px bold or large text; for small body copy, prefer `on-surface`).
- **Primary**: `#2C2C2C` (near-black; primary buttons are black). `on-primary` `#F4F1EE`.
- **Meaningful color**: `error` `#ef4444` (conflict / unavailable / delete). Roster role chips carry their own assigned colors. Holidays = error-tint pill. Birthdays = secondary tint + cake icon.
- Contrast rule: body text ≥4.5:1; never muted taupe for paragraph text on paper.

## Type
- **Display / headings**: Playfair Display (serif), weight 700–900. Utility classes `font-display-lg` (36px), `font-headline-md` (24px).
- **Body / UI**: Inter (sans). Sizes via `font-body-lg/md`, label `font-label-sm` (10px, tracking .1em).
- Two families only (serif display + sans body). Page titles serif-black; everything else Inter.

## Shape & spacing
- Generous radii: cards `rounded-[24px]`–`rounded-[40px]`, controls `rounded-2xl`. Pills `rounded-full`.
- Soft shadows (`shadow-sm`, occasional `shadow-xl`). Borders `border-outline-variant/10–30`.
- 8px spacing base; section padding `p-6 md:p-8`.

## Components / conventions
- Primary action = solid black pill (`bg-black text-white`, uppercase tracked, `whitespace-nowrap`).
- Secondary = white pill with `border-outline-variant/30`.
- Material Symbols icon font for all icons.
- Motion via `motion/react` (framer-motion). Ease-out, short; respect reduced-motion.
- Bilingual: every button/label uses `whitespace-nowrap` so zh/en don't stack.

## Layout
- App shell: fixed left sidebar + top header (`bg-surface`), content area `bg-surface`. All one tone (no panel seams).
- Roster = monthly grid: weekday header row, day cells stack [date · holiday pill · 🎂 birthdays · assignment chips]. States: today (black chip), Sunday (faint primary tint), unavailable (error tint + OFF badge), conflict (error border + warning).
