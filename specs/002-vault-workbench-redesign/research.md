# Phase 0 — Research

Decisions taken before design, each recorded with what was rejected and why. Everything here was
checked against the codebase rather than assumed; where the handoff and the source disagreed, the
source won.

---

## 1. How the rail reads the lock deadline

**Decision**: add `export function getLockAt(): number | null` to `frontend/src/vault/auto-lock.ts`.
`reset()` records `lockAt = Date.now() + minutes * 60_000` when it arms the timer, and sets it to
`null` on the early return when the vault is locked. The chip polls it once a second.

**Rationale**: `reset()` is bound to `pointerdown`, `keydown`, `scroll`, `touchstart` and `focus`.
During a scroll it fires continuously. A `subscribeRemaining(cb)` callback would therefore fire
tens of times a second, and every subscriber would re-render on each — for a value that only needs
to change once a second. Polling inverts that: exactly one re-render per second regardless of how
much the user is moving.

`null` while locked matters: `reset()` already returns early when `!isUnlocked()`, *after* clearing
the timer, so there is genuinely no deadline in that state. Returning a stale number would let the
chip count down against a vault that is already closed.

**The hazard this must avoid**: the countdown must not itself count as activity. A `setInterval`
does not fire any of the five activity events, so the chip cannot keep the vault alive — but any
future implementation that, say, re-focused an element to force an update would silently defeat
auto-lock. The test suite pins this: the deadline must not move while only the interval runs.

**Alternatives rejected**:
- *`subscribeRemaining(cb)`* — the handoff's first suggestion. Correct but noisy, per above.
- *Compute the deadline in the component from `configureAutoLock`'s return* — the component would
  have to observe every activity event itself, duplicating the logic it is meant to be reading.
- *Expose the timer handle* — leaks the mechanism and invites callers to cancel it.

---

## 2. Fonts, offline

**Decision**: vendor Caprasimo 400 and Figtree 400/500/600/700 as woff2 under
`frontend/public/fonts/`, declare them with `@font-face` and `font-display: swap` at the top of
`theme.css` in place of the `@import`, and extend the service worker's precache glob to include
`fonts/*.woff2`.

**Rationale**: the supplied `theme.css` line 19 is
`@import url('https://fonts.googleapis.com/css2?...')`. That is a network request on first paint.
This application has an offline mode whose entire purpose is that a vault opens with no network,
so the unlock screen — the *first* thing an offline user sees — would render in fallback faces at
the wrong metrics. The service worker already precaches by glob in `vite.config.ts`; the fonts
need to be in it.

A second reason, smaller but real: a font request to a third party at unlock time tells that third
party when this user opened their password manager. The application makes a point of not leaking
metadata; importing a font from Google's CDN would undo a little of that for no benefit.

**Alternatives rejected**:
- *Keep the `@import`* — fails FR-031 and the offline unlock outright.
- *Runtime-cache the font on first use* — the first use is the offline case we are trying to serve.
- *System fonts only* — abandons the design's typography, which is most of its character.

**Licence check required before implementation**: both faces are OFL, which permits vendoring, but
the licence files must be included alongside the woff2 rather than assumed.

---

## 3. Icons

**Decision**: add `lucide-react`, and wrap it in a single `components/Icon.tsx` that fixes
`strokeWidth={2.75}` and exposes a `size` prop. Import icons individually so the bundle carries
only the ~30 the design names.

**Rationale**: the design specifies Lucide at a stroke width that is not the library default (2).
Setting it at each of a hundred call sites invites drift; one wrapper makes it a single fact.
Individual imports keep tree-shaking effective — `lucide-react` is large if imported wholesale.

**Alternatives rejected**:
- *Inline SVG per icon* — ~30 hand-maintained SVGs, and the stroke width becomes a per-file
  property nobody checks.
- *An icon font* — worse offline story than the fonts problem above, and poorer accessibility.

**Note on the dependency**: `lucide-react` is presentational and handles no cryptography,
authentication or serialization, so the constitution's pinning rule does not cover it. It should
still be pinned to an exact version for reproducibility, consistent with the rest of the repo, and
the CI pinning check's pattern does not need to change.

---

## 4. Deriving a template's colour (FR-023, Principle V)

**Decision**: a small deterministic string hash of `template.name` (FNV-1a, 32-bit) modulo the
number of available tint pairs, in a pure function with its own unit test.

**Rationale**: Principle V requires that adding a secret type is data, not code. A `switch` on
"Login" / "Credit card" / "Secure note" — which is what the handoff's prose describes before it
corrects itself — would mean a template added tomorrow falls to a default and looks broken. A hash
gives every name a stable tint forever, with no registry to maintain.

The tint pairs come from the token set: terracotta 200/700, sage 200/800, neutral 200/800 and
neutral 300/900. All four are specified by the handoff, so the palette is not being invented.

**What the test must pin**: the same name always yields the same pair (stability across sessions is
the whole point), and every output is one of the four permitted pairs.

**Alternatives rejected**:
- *Hash the template id* — ids are UUIDs, so the same built-in type would tint differently in two
  accounts, and a restored backup would re-tint everything.
- *Store a colour on the template* — a schema change, for decoration.

---

## 5. Where `selectedSecretId` lives

**Decision**: in `SecretList.tsx`, which becomes a container rendering the list column and the
detail pane as siblings.

**Rationale**: `SecretList` already owns the decrypted items, the filter state, the search hits and
every mutation callback (`file`, `toggleTag`, `update`, `remove`). The detail pane needs all of
them. Lifting selection to `App.tsx` would mean lifting the item list too, or passing a lookup
down — moving state away from its data for no gain.

**Consequence for the rail**: the rail needs `FilterState` **and its setter**, and the rail is
rendered by `App`. So filter state is lifted out of `SecretList` into `App` (T021a), and
`SecretList` reads it as props — the same shape `onDataChanged` already established for folders,
tags and counts.

An earlier draft had `SecretList` keep ownership and push the value up through `onDataChanged`.
That does not work: `onDataChanged` is a one-way notification, so the rail's `onChange` would have
to reach back down into the component that owns the state. Lifting is the smaller change and the
only one where data flows in a single direction.

**Alternatives rejected**:
- *Selection in `App.tsx`* — see above.
- *Selection in the URL* — the app has no routing for vault state today, and adding it would make
  a secret's identity a browser-history entry. That is a privacy decision, not a layout one.

---

## 6. Keeping `updatedAt`

**Decision**: carry `updatedAt` from `SecretRecord` into `DecryptedSecret` in `SecretList`'s
decrypt loop. Display it in the detail footer as a relative time, labelled as when the secret was
last **changed**.

**Rationale**: the value is already on the wire (`shared/src/api.ts:183`, and the list route
returns it) and already parsed — the client simply drops it when building `DecryptedSecret`. No
type, endpoint or request-shape change is involved, so this stays inside the "presentation only"
boundary.

**What it must not be used for**: the "Recently used" scope, which the spec cuts (FR-030a).
Last-changed is not last-used, and labelling it as usage would be the kind of quiet
misrepresentation FR-030 exists to prevent.

---

## 7. Dark mode removal, mechanically

**Decision**: replace `theme.css` wholesale with the supplied file, and change
`frontend/index.html` from `<meta name="color-scheme" content="light dark">` to `content="light"`.

**Rationale**: the supplied theme defines no dark palette and no `prefers-color-scheme` block. If
the meta continues to advertise dark support, a dark-preferring browser will render form controls,
scrollbars and autofill backgrounds in dark against a cream page — the worst of both. Declaring
`light` makes the page's actual capability honest to the browser.

**Alternatives rejected**: covered in the spec's "Decisions taken". Keeping the old dark block is
the trap — it overrides only the legacy aliases, so a dark user would get cream panels with dark
text.

---

## 8. A defect the handoff caught in the existing code

**Finding**: `frontend/src/theme.css` currently sets `main button { min-height: 2.25rem }` inside
its narrow-screen block. That is **36px**, not the 44px the requirement asks for. The supplied
`theme.css` sets `44px`.

No test asserts touch-target size — the existing Playwright checks verify horizontal scroll only —
so the shortfall has never failed a build, and an earlier report in this project's history claimed
the 44px guarantee was met when the CSS did not enforce it.

**Decision**: adopt the supplied 44px, and add a Playwright assertion that measures the rendered
height of every interactive element at 360px rather than trusting the stylesheet. Swapping
`theme.css` fixes the CSS; only a measurement stops it regressing.

**Why it belongs here**: this is a pre-existing accessibility defect, not something the redesign
introduces. It is in scope because SC-004 and FR-027 make the guarantee explicit, and because
fixing it costs one line plus one assertion.

---

## 9. Test strategy for a redesign

**Decision**: three layers, in this order.

1. **Characterisation tests first, for the security-critical components.** Before `SensitiveField`
   and `CopyButton` are touched, unit tests pin the mask width, the auto-re-hide interval, the
   clipboard clear, all three acknowledgement strings and both `aria-label` formats. Before
   `auto-lock.ts` is touched, unit tests pin the deadline, the null-when-locked case, the reset on
   activity, and the unchanged ceiling. These are written against the *current* behaviour and must
   pass before and after.
2. **A pure-function test for the tint hash**, per Principle V.
3. **Existing end-to-end suites updated for selectors only.** Assertions about behaviour must not
   be weakened. Where a control's visible name changes ("Close settings" → "Back to the vault"),
   the selector changes and the assertion stays.

**Rationale**: the danger in a redesign is not that something looks wrong — that is visible. It is
that a timer, a mask width or a clipboard clear quietly stops working while the interface looks
correct. Characterisation tests written *before* the change are the only way to know the behaviour
survived, and Principle IV requires exactly this for session lifecycle.

**Requires**: `@testing-library/react`, which the repo does not have. jsdom is already configured
in `frontend/vitest.config.ts`.

**Alternatives rejected**:
- *Rely on the Playwright suite* — it covers reveal and copy only incidentally, runs in a browser,
  and cannot assert a 30-second timer without either waiting 30 seconds or faking timers in a
  process it does not control.
- *Write the tests afterwards* — they would be written against the new code and would pass by
  construction, proving nothing about preservation.

---

## Open questions

None. The five product questions were decided during specification; the technical unknowns above
are resolved. Two items need a check during implementation rather than a decision now:

- **Font licences** must be included when vendoring (§2).
- **`Filters.tsx`'s exported types** (`FilterState`, `NamedItem`, `UNFILED`) are imported by both
  `SecretList` and `App`; they need a home when the component is absorbed into the rail. Suggested:
  keep the module, export the types and `UNFILED` from it, and delete only the component.

## Icon-name verification (T006, CHK035)

Checked 2026-09-07 against `lucide-react` pinned at **1.42.0**. All **32** icon names the handoff
lists under Assets resolve as exports: shield, lock, key-round, clock, inbox, folder, users, user,
user-plus, plus, search, copy, eye, eye-off, pencil, trash-2, settings, timer, refresh-cw,
cloud-off, mail, mail-check, triangle-alert, hourglass, chevron-down, arrow-left, history, archive,
file-text, smartphone, list-ordered, x.

**None missing**, so FR-022c's substitution clause is not exercised. Re-run the check if the pin moves.
