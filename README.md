# QrPrinter landing page — the guide for whoever edits it next

You do not need to be a programmer to change most of this page, and you do not need to
ask anyone for help. This file tells you where everything lives, what to change for the
ten edits people make most often, and how to check your work before publishing.

---

## 1. What this is

A marketing landing page for a printing and scanning management platform aimed at cyber
cafes, photocopy shops and document service centres.

* It is **one page** plus three small static pages (`/help.html`, `/privacy.html`, `/terms.html`).
* There is **no database, no login and no server code**. "Login" and "Get Started" are
  links to the product app, whose address you set in one place (see 5.1).
* Built with React + Vite (the tool that turns the source into plain files) and
  Tailwind CSS v4 (styles written as class names). Icons come from `lucide-react`.
* The dashboard you see on the page is **a mock built from real HTML and sample data**,
  not a screenshot — so you can change any number in it by editing text (see 5.9).

---

## 2. Running it for the first time

You need Node.js 22 or newer (this project was built on Node 24).

```bash
npm install        # once, to download the build tools
npm run dev        # live preview at http://localhost:5173 — edits appear instantly
npm run build      # produces the publishable folder in dist/
npm run preview    # serves dist/ at http://localhost:4173 to check the real build
```

`dist/` is generated output. **Never edit anything inside `dist/`** — the next build
overwrites it.

---

## 3. The five files you are allowed to edit for normal changes

| Want to change | Edit this file |
| --- | --- |
| Product name, domain, app URL, support email, theme colour | `src/config/brand.js` |
| Where every button and link points | `src/config/links.js` |
| **Any word, image label, price, question, feature or sample data** | `src/data/content.js` |
| Colours, dark mode, glass, hover and motion rules | `src/index.css` |
| Page layout / adding a whole new section | files in `src/components/` |

Roughly 90% of the work is inside `src/data/content.js`. It is one big list of plain
English objects — no logic, no styling.

---

## 4. Project map

```
index.html                      page shell, SEO tags, fonts, the no-flash theme script
vite.config.js                  build setup + fills SEO tags from brand.js
public/
  favicon.svg                   browser tab icon
  og-cover.svg                  image shown when the page is shared on WhatsApp etc.
  help.html privacy.html terms.html   the three static pages linked from the footer
src/
  main.jsx                      starts React
  App.jsx                       the order of sections on the page
  index.css                     every colour, radius, shadow, glass and motion rule
  config/brand.js               name, urls, email, theme colour, navbar items
  config/links.js               the single link table (login, signup, contact, legal…)
  data/content.js               ALL the copy and the sample dashboard data
  lib/theme.js                  reads/writes the saved theme choice
  lib/useTheme.js               shared theme state for the page
  components/layout/            Navbar.jsx, Footer.jsx
  components/sections/          Hero, Benefits, Features, HowItWorks, Compatibility,
                                DashboardSection, Pricing, Faq, FinalCta
  components/ui/                reusable parts: Button, Card, Badge, Section,
                                SectionHeading, Logo, Icon, ThemeToggle, Reveal
  components/product/           DashboardPreview.jsx (the dashboard mock)
```

---

## 5. Everyday changes

### 5.1 Rename the product and point everything at your domain

`src/config/brand.js` lines 9–20:

```js
export const brand = {
  name: 'QrPrinter',                       // appears in the title bar, logo, SEO tags
  url: 'https://example.com',              // your public site address (no trailing /)
  appUrl: 'https://app.example.com',       // where users actually log in / sign up
  supportEmail: 'support@example.com',     // used by every "Contact Us" / support link
  ogImage: '/og-cover.svg',
  themeColor: '#0e1c33',                   // browser chrome colour before the page paints
  copyrightName: 'QrPrinter',
}
```

Change these seven values and the page title, all CTA buttons, the mailto links, the Open
Graph URL and the footer copyright all follow. Nothing else needs touching.

### 5.2 Replace the logo

The logo is drawn as SVG so it stays sharp on every screen and costs nothing to download.
Edit `src/components/ui/Logo.jsx` — it is a small shape plus the wordmark text. It uses
`--color-logo-bg` / `--color-logo-fg` so it flips automatically in dark mode; keep those
variables or the logo disappears on one theme. Also replace `public/favicon.svg` and
`public/og-cover.svg` to match.

### 5.3 Change any wording

`src/data/content.js` is laid out in the same order as the page:

| Export | Line | Section it feeds |
| --- | --- | --- |
| `hero` | 13 | headline, description, two CTAs, three highlight chips, floating glass chip |
| `benefits` | 35 | "Why shop owners switch" — 6 items |
| `features` | 74 | the 8 feature cards |
| `steps` | 137 | How It Works — 4 steps |
| `compatibility` | 166 | device list + the honesty note under it |
| `dashboard` | 206 | sample data for the dashboard preview |
| `pricing` | 248 | the three plans + the disclosure line |
| `faq` | 307 | the 10 questions (`q`) and answers (`a`) |
| `finalCta` | 356 | closing headline and note |
| `footer` | 365 | the four link columns and legal row |

Each item looks the same way:

```js
{ icon: 'printer', title: 'Multi-Printer Management',
  text: 'Add every connected printer to one dashboard…', status: 'live' }
```

Editing a string is enough. Save, and the dev server reloads.

### 5.4 Add, remove or hold back a feature

* **Remove** — delete the whole `{ … },` block, comma included.
* **Add** — copy an existing block, change the text, pick an `icon` that exists (see 5.5).
* **Hold back** — set `status: 'planned'`. The card then shows a "Coming soon" badge
  instead of reading like a promise. Keep `status: 'live'` only for things that actually
  work today; this is deliberate (see section 6).

### 5.5 Add an icon

Icons are a whitelist, not a lookup by magic name. Two lines in
`src/components/ui/Icon.jsx`:

```js
import { Zap } from 'lucide-react'   // 1. add to the import list at the top
const registry = { zap: Zap, … }     // 2. add the key you will use in content.js
```

If the name in `content.js` is not in that registry, the icon silently disappears — the
component returns nothing rather than crashing. If an icon is missing from a card, that
mismatch is almost always the reason.

### 5.6 Put in real prices

In `src/data/content.js` (line 258 onward) each plan has `amount: null`. While it is
`null` the card prints `₹ —` plus "Not announced yet", and the disclosure line under the
grid says the section is a template. That is intentional: the page must not advertise a
number nobody has agreed to.

```js
{ name: 'Starter', amount: '₹499', period: 'per month', cadence: 'For a single counter…', … }
```

`amount` is the big number, optional `period` sits next to it, `cadence` is the line under
them. Set `amount` for all three plans, then delete or rewrite `pricing.disclosure`
(line 303), otherwise the page still calls itself a template. `featured: true` puts the
"Most popular" badge and the glass treatment on that card.

### 5.7 Add an FAQ question

```js
{ q: 'Can I print from my own laptop?', a: 'Yes — install the agent on…' },
```

The first question is open when the page loads (`useState(0)` in
`src/components/sections/Faq.jsx:48`); change that number to open a different one, or `null`
to start with all closed. Answers are plain text — a link inside an answer needs a code
change, so keep answers link-free.

### 5.8 Add a whole new section

Three steps:

1. Create `src/components/sections/Newsletter.jsx` and copy the shape of any existing
   section — `<Section id="newsletter">` plus `<SectionHeading …>` from `src/components/ui/`.
2. Import it and place it in `src/App.jsx` (line 29) — the order there is the order on screen.
3. If it should appear in the navbar, add `{ label: 'Newsletter', href: '#newsletter' }`
   to the `nav` array in `src/config/brand.js`. The navbar highlights the section
   automatically and the mobile menu picks it up; the `id` must match exactly.

### 5.9 Edit the dashboard preview

`src/data/content.js:206` — `stats` (four headline numbers), `printers`, `jobs`, `scans`,
and `states` (the label + colour for each status). A job looks like:

```js
{ id: 'J-1042', file: 'aadhaar-scan-01.pdf', pages: 2, copies: 3,
  printer: 'Counter LaserJet', state: 'completed', time: '11:42' }
```

`state` and the printer `status` must be one of the keys in `states` (`completed`,
`processing`, `pending`, `failed`, `online`, `busy`, `offline`); an unknown key renders no
badge. Keep the numbers plausible and keep `dashboard.caption` — it is what tells the
visitor this is sample data.

### 5.10 Change colours and the dark theme

All colour decisions live in `src/index.css`, and components never use raw hex values. Two
blocks matter:

* `@theme` (line 16) — the light-theme definitions.
* `.dark` (line 94) — the same variables, redefined for dark.

Components use the *role* names, so changing a role in those two blocks restyles the whole
page in one go:

| Role | Light | Dark | Used for |
| --- | --- | --- | --- |
| `ink` | `#0e1c33` | `#eef4fc` | headings |
| `body` | `#3d4f66` | `#b6c6db` | paragraphs |
| `muted` | `#5a6b83` | `#8ea3c0` | small captions |
| `surface` | `#ffffff` | `#0e1a2e` | cards, navbar glass |
| `canvas` | `#f7f9fc` | `#080f1d` | page background |
| `soft` / `soft-ink` | `#f4f7fb` / `#263c5e` | `#16263e` / `#cddff5` | chips, hover fills |
| `accent-text` / `accent-soft` | `#12529f` / `#eff6ff` | `#8ec5fd` / `#12304f` | links, active states |
| `line` / `line-strong` | `#e4e9f1` / `#c9d6e8` | `#223650` / `#33496a` | borders |
| `band*` | navy `#0e1c33` family | near-black family | the dark closing section + footer |
| `success` / `warn` / `danger` | green / amber / red | lighter variants | status badges |
| `logo-bg` / `logo-fg` | `#0e1c33` / `#ffffff` | `#dce8f8` / `#0e1c33` | logo plate |

Two rules that keep dark mode from breaking:

* **Never add `dark:` classes to a component.** Add or change a token instead. Scattered
  `dark:` overrides are exactly how a text colour ends up unreadable on one theme.
* Anything on the dark bands (`band`, `band-deep`) uses `band-*` or fixed `navy-*` tokens
  and must stay readable on a dark background in **both** themes — the band does not go
  light in light mode.

The theme itself: the switch is the moon/sun button in the navbar and the "Dark mode" row
in the mobile menu. A visitor's choice is saved in `localStorage` under `qp-theme`; with
nothing saved, the page follows the operating system. `index.html` contains a short inline
script that applies the class *before* first paint so dark-mode visitors never see a white
flash. To ship light mode only: delete the `ThemeToggle` uses in
`src/components/layout/Navbar.jsx`, remove the `useTheme` wiring in `src/App.jsx`, the boot
script in `index.html` and the `.dark` block in `src/index.css`.

### 5.11 Glass and hover behaviour

Glass is used on exactly five surfaces, deliberately — a whole page of frosted panels is
expensive to render and hurts readability on cheap shop monitors:

| Surface | Where |
| --- | --- |
| `glass` | sticky navbar |
| `glass-strong` | mobile menu sheet, featured pricing card |
| `glass-on-band` | closing call-to-action panel, hero floating chip |

Definitions are in `src/index.css:207–236`, and line 228 is a `@supports not (backdrop-filter…)`
fallback that swaps in solid colours on old browsers and locked-down machines — keep it.
To make a card glass, pass the prop: `<Card glass>`.

Hover: `.hover-lift` (line 270) adds the 3px lift, and it only applies when the device
reports a real mouse **and** the visitor has not asked for reduced motion. Cards set
`hover` on `<Card>` / a `group` class, and the child icon or title reacts through
`group-hover:*`. Motion-reduce is respected globally by the block at line 285.

### 5.12 Footer, legal pages and SEO

* Footer columns: `src/data/content.js:365`. A link with `href` is used verbatim; a link
  with `kind` is resolved through `src/config/links.js`.
* `links.js` is the only place that knows destinations. `/help.html`, `/privacy.html` and
  `/terms.html` are **placeholder pages that ship with the template** and each one lists
  what a real version must cover. Replace their content before launch.
* SEO: `index.html` holds `%BRAND_NAME%`, `%DESCRIPTION%`, `%OG_TITLE%`, `%SITE_URL%`,
  `%OG_IMAGE_URL%` and `%THEME_COLOR%` tokens, filled from `brand.js` at build time by the
  `brandMeta()` plugin in `vite.config.js`. Edit `brand.js`, not `index.html`.

---

## 6. Rules this page is built on

These are not style preferences; they are the reasons certain things are written the way
they are. Breaking them makes the page dishonest or unusable.

1. **No invented numbers.** No fake customer counts, no "trusted by 10,000 shops", no
   testimonials that were never given.
2. **No fake endorsements.** No certifications, no manufacturer partnerships, no claims
   that HP/Canon/Epson are specifically supported unless someone has actually tested it.
3. **Do not advertise what is not built.** Un-shipped features stay `status: 'planned'`;
   un-agreed prices stay `amount: null`; un-confirmed technical behaviour in FAQ answers
   stays conditional and points at the support email.
4. **Sample data stays labelled.** Keep `dashboard.caption` and the pricing disclosure
   until both are real.
5. **Contrast stays at 4.5:1 or better** for normal text (3:1 for large text) in both
   themes. If you add a colour, check it against both backgrounds — the fastest way to
   wreck this page is to write `text-white` on a surface that goes white in light mode.
6. **Heading order stays intact** — one `<h1>`, then `<h2>` per section, `<h3>` inside.
   The dashboard mock intentionally uses plain `div`/`p` because it is a picture of the
   app, not part of the document outline; do not turn those into headings.
7. **Keep it light.** This page ships to shops on slow connections. No new dependency
   without checking the size cost, no big images (there are currently zero raster
   images), no animation libraries — the reveal effect is 50 lines of IntersectionObserver.
8. **No horizontal scrolling on phones.** `body` uses `overflow-x: clip`; if a new section
   overflows, fix the section rather than allowing a sideways page.

---

## 7. Check your work before publishing

```bash
npm run build     # must finish with no errors
npm run preview   # open http://localhost:4173
```

Then walk the list:

- [ ] Read the page top to bottom in **light** mode, then in **dark** mode (navbar switch).
      Anything unreadable in either? That is a token problem, fix it in `index.css`.
- [ ] Resize the window to phone width (~375px), tablet (~768px) and desktop (1440px).
      No sideways scrolling, no clipped buttons, no overlapping cards.
- [ ] Open the mobile menu, tap a link, press Escape — it must close and hand focus back.
- [ ] Open and close a few FAQ questions with the mouse **and** with Tab + Enter.
- [ ] Press Tab from an empty page state: the first stop should be "Skip to content".
- [ ] Click every CTA. They must land where you expect (`brand.appUrl` for signup/login,
      a real mailbox for contact).
- [ ] Hover the cards; check the browser console (F12) shows no red errors.
- [ ] Search the page text for `example.com`, `QrPrinter`, `₹ —` and "placeholder" — those
      are the template markers still waiting for real values.
- [ ] Run `npm run build` one last time so `dist/` matches what you just checked.

---

## 8. When something looks wrong

| Symptom | Cause and fix |
| --- | --- |
| A build failed after a content edit | Usually a missing comma or an accidental quote inside a string. `content.js` is JavaScript — a `'` in copy like `don't` needs `"don't"` or `don\'t`. |
| An icon is missing | The name is not in `src/components/ui/Icon.jsx` — see 5.5. |
| A status badge is missing | The `state`/`status` string is not a key in `dashboard.states` — see 5.9. |
| Text unreadable in dark mode | Someone used a raw colour instead of a role token; move it into the `@theme` / `.dark` blocks. |
| The page flashes white for dark-mode users | The inline script in `index.html` was removed or moved after the stylesheet. |
| Theme switch does nothing | `App.jsx` must pass `theme` / `onToggleTheme` from `useTheme()` into `Navbar`. |
| Sticky navbar covers a heading when a nav link is clicked | `scroll-padding-top` in `src/index.css:137` must stay larger than the navbar height. |
| A footer link 404s | Its `kind` is missing from `src/config/links.js`, or the file in `public/` was deleted. |
| Edits don't appear | You edited `dist/`, or the preview server is serving an old build — rerun `npm run build`. |
| Page is entirely blank | A JavaScript syntax error. Open the browser console (F12) and read the first message. |

---

## 9. Putting it online

`npm run build` produces `dist/` — plain static files, no server needed. Upload the
contents of `dist/` to any static host (Netlify, Vercel, Cloudflare Pages, an nginx
`root`, or object storage with static hosting). Set the site's domain in
`src/config/brand.js` (`url`) **before** the build so the Open Graph tags point at the
right image, and re-test `https://yourdomain/og-cover.svg` resolves.

There is nothing to configure on the server side, no environment variables and no API keys.
