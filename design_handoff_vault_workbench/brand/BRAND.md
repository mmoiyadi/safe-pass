# Incorporating Cairn into the app

Written against your repo as it stands. The app does not currently call itself "safe-pass" anywhere a user can see — `index.html` says **"Password Manager"** and the manifest says **"Password Manager"** / short name **"Vault"**. `safe-pass` appears in exactly two places, both deploy config: the service name in `render.yaml`, and an example `APP_URL` in `docs/operations.md`. So this is less a rename than a naming: the product has never had one.

## Files here

**Vector** — for the interface and anything that scales:

| File | Use |
| --- | --- |
| `cairn-mark.svg` | The mark, alternating stone weights. `fill: currentColor`. 32px and up. |
| `cairn-mark-solid.svg` | Same geometry, one flat weight. For tiles. |
| `cairn-mark-small.svg` | Three stones, 20–32px. |
| `cairn-mark-micro.svg` | Two stones, below 20px. |
| `favicon.svg` | 32px tile, cream on terracotta. |
| `app-icon-512.svg`, `app-icon-512-sage.svg`, `app-icon-maskable-512.svg` | Icon masters. |

**Raster** — drop-in replacements for the PNGs already in `frontend/public/`, at the same names and sizes:

`icon-192.png` · `icon-512.png` · `icon-maskable-512.png` · `apple-touch-icon-180.png` · `favicon-32.png` · `favicon-16.png` · `icon-512-sage.png`

The maskable one is full-bleed with the mark pulled inside the 80% safe circle, so Android's mask cannot clip a stone. All of them are fitted to the mark's true bounding box rather than the 48-unit artboard, so the small sizes carry the same optical weight as the large ones.

There is no SVG of the wordmark: Caprasimo is a webfont, and text in an SVG renders in a fallback face wherever the font is not loaded. Set the word in HTML with `font-family: var(--font-heading)` beside an inline mark instead — that is how the rail lockup is built.

## 1. Name it

- **`frontend/index.html` line 7** — `<title>Password Manager</title>` → `<title>Cairn</title>`.
- **`frontend/public/manifest.webmanifest`** — `"name": "Cairn"`, `"short_name": "Cairn"` (drop "Vault"; the mark is doing that job now). Keep `description` as it is — it is accurate and well written.
- **`render.yaml` line 14** — `name: safe-pass` → `name: cairn`. This changes your Render service URL, so update `APP_URL` in the same breath or verification and invitation emails will point at the old origin.
- **`docs/operations.md` line 33** — the example `APP_URL`.
- **`backend/`** — check email subjects and any `From` display name for "Password Manager".

Leave `frontend/package.json`'s `"name": "frontend"` alone; it is a workspace identifier, not a product name. Same for database names and env-var prefixes — renaming those is a migration, not a rebrand.

## 2. Colour the shell

Your manifest and `index.html` both carry `#12141a`, a near-black left over from the dark theme. On Organic that is wrong twice over: it tints the browser chrome nearly black against a cream page, and it makes the PWA splash flash dark before a cream app paints.

- `index.html` line 11 — `<meta name="theme-color" content="#c67139">`
- `manifest.webmanifest` — `"theme_color": "#c67139"`, `"background_color": "#f5ead8"`

## 3. Swap the icons

Copy the six PNGs into `frontend/public/`, overwriting `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`. Then add the two lines `index.html` is missing (it currently points `apple-touch-icon` at the 192 PNG, which iOS scales badly, and has no SVG favicon):

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" />
```

No service-worker change is needed. `vite.config.ts` uses `injectManifest` with `globPatterns` already covering `png`, `svg` and `woff2`, so Workbox re-revisions the changed icons on the next build and clients pick them up without a cache-name bump. Do confirm the offline flow still works after the first reload post-deploy.

## 4. Fonts

`frontend/public/fonts/` already exists, so you are self-hosting. Put Caprasimo and Figtree woff2 files there and `@font-face` them from `theme.css` rather than using the Google Fonts `@import` in the supplied stylesheet — the app has an offline mode, and a webfont fetched at unlock time fails in an offline session. Once they are in `public/fonts/`, the existing `globPatterns` precaches them automatically.

## 5. The mark in the interface

One component, and nothing else imports the SVGs directly:

```tsx
// frontend/src/components/Mark.tsx
export function Mark({ size = 24 }: { size?: number }) {
  if (size < 20) return <MarkMicro size={size} />;
  if (size < 32) return <MarkSmall size={size} />;
  return <MarkFull size={size} />;
}
```

Each variant is the matching SVG above, inlined, with `fill="currentColor"` so colour comes from CSS. Inline rather than `<img>`: it inherits colour, costs no request, and is there before first paint.

The rail lockup from the design reference — this replaces the `shield` icon and product name in the rail's brand row (main README §2.1, item 1):

```tsx
<span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' }}>
  <span style={{
    width: 34, height: 34, borderRadius: 11, background: 'var(--color-accent)',
    color: 'var(--color-bg)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  }}>
    <Mark size={20} />
  </span>
  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 19, letterSpacing: '-0.01em' }}>
    Cairn
  </span>
</span>
```

That tile is the only place inside the interface that uses the icon form. Everywhere else — unlock, emails, the backup file header — the word alone is enough.

## 6. Rules worth keeping

- Clear space on all four sides equals the height of the top stone.
- Never centre the stones. The −1 · +1 · −1 offsets are the mark.
- Solid fills only: no outline, gradient, bevel or drop shadow.
- Scale square. Never stretch the stack.
- Drop a stone as it shrinks — that is what the three vector variants are for.

## 7. Before this goes anywhere public

Cairn Security (cairn-security.com) is an active cybersecurity company in an adjacent segment, and I could not reach a trademark register to check classes 9 and 42. Clear that before you buy the domain, submit to an app store, or print it. Renaming a shipped password manager costs far more than a lawyer's half hour — RookPass had to do exactly that.
