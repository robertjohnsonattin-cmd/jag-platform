# Frontend rules (React / Tailwind / i18n)

> Split out of CLAUDE.md. Read this before building any UI component.

### React date inputs — PG DATE/TIMESTAMP values
PostgreSQL `DATE`/`TIMESTAMP` columns may arrive from the API as ISO datetime strings (`'2025-12-31T00:00:00.000Z'`). A browser `<input type="date">` cannot display ISO datetime format — it shows empty placeholder but still submits the full string, failing Zod's `^\d{4}-\d{2}-\d{2}$` regex.

**Always** initialize date-input state by slicing to 10 chars and guard on submit:
```tsx
// CORRECT
const [maturity, setMaturity] = useState(inv.maturity_date ? inv.maturity_date.slice(0, 10) : '')
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// in mutationFn:
maturity_date: (maturity && DATE_RE.test(maturity)) ? maturity : undefined,
```
Apply to every date field: `purchase_date`, `maturity_date`, `expiry_date`, `as_of_date`, etc.

### Displaying date-only values — never `new Date(iso).toLocaleDateString()`
Same underlying PG DATE-as-ISO-string issue as above, but on the *display* side. `new Date('2026-09-30')` parses the string as **UTC midnight**; `.toLocaleDateString()` then renders that instant in the browser's local timezone. Trinidad is UTC-4, so the displayed date silently shifts back one day (shows "29 Sept" for a DB value of "2026-09-30") — no error, easy to miss. Passing an explicit `timeZone` option does **not** fix this — it just makes the same wrong shift deterministic. Found 2026-07-06 in the shared `fmtDate()` helper (`jag-web/src/lib/entities.ts`) plus 10 duplicated local helpers across CRM/DocVault/DragonBridge/Entertainment/Family/Inventory/JABCO/NLCB/Purchasing/Succession — all fixed same session.

**Always** parse the Y/M/D components directly instead of letting `Date()` interpret the string:
```tsx
// WRONG — shifts back a day in Trinidad's timezone
new Date(iso).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })

// CORRECT
const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
new Date(y, m - 1, d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
```
**Do NOT apply this to real timestamps** (`created_at`, `updated_at`, `paid_at`, `last_modified_at`, event `starts_at`/`ends_at`) — converting a genuine instant to local time via plain `new Date(iso).toLocaleDateString()` is correct there. If one helper is shared between date-only and timestamp fields, split it into two (e.g. `fmtDate` for timestamps, `fmtDateOnly` for date-only) rather than fixing it in place — check the column type in the migration file before deciding which side a field is on. Same fix applies to month/year-only formatters (e.g. depreciation `period_start`/`period_end`) — a value like `'2026-10-01'` shifted back to Sept 30 local would show the wrong *month*, not just the wrong day.

### Mobile responsive patterns (Tailwind)
No separate mobile app — the React + Tailwind stack handles all screen sizes. The shell (AppShell.tsx) is already mobile-aware (hamburger menu, slide-over sidebar). Rules for all new components:

- **Grid layouts on main pages**: always add a mobile breakpoint — `grid-cols-1 sm:grid-cols-3` not bare `grid-cols-3`; `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` for 5-column KPI strips
- **Table wrappers**: use `overflow-x-auto rounded-lg border border-slate-700` not `overflow-hidden` — the horizontal scroll is the correct mobile behaviour; `overflow-hidden` traps wide tables
- **Master-detail layouts** (list sidebar + detail panel): use mobile toggle pattern — list is `${selected ? 'hidden md:flex' : 'flex'} w-full md:w-64`, detail is `${!selected ? 'hidden md:block' : 'block'} flex-1`. Add a `md:hidden` back button at top of detail pane using `t('common.back')` (`← Back` / `返回` — key exists in both locale files)
- **Master-detail list pane MUST also have `min-w-0`** (session 46) — `flex flex-col ${selected ? 'hidden md:flex md:w-XX' : 'flex-1'}` alone is not enough. A flex item's default `min-width` is `auto`, so a `flex-1` list pane refuses to shrink below its content's natural width (e.g. a filter row with 2-3 `<select>`s). On mobile this doesn't show up as a visible page-level scrollbar — the wider content gets silently clipped by a sibling `overflow-hidden` wrapper instead, so search boxes / filter dropdowns / buttons just vanish off the right edge with no way to reach them. Always add `min-w-0` to the list-pane div alongside `flex-1`. Found across 12 list/detail screens (Properties, CRM, Inventory ×3, DragonBridge ×2, Entertainment ×3, NLCB, Purchasing, DocVault) — all fixed session 46.
- **Tab bars need `overflow-x-auto` explicitly** (session 46) — a `<div className="flex border-b ...">` of tab buttons with no `overflow-x-auto` doesn't just clip on mobile, it can force the **entire page** to scroll horizontally (found on Inventory's 7-tab top bar — the missing class on that one div pushed the whole `<body>`). Any row of ≥3 tab-style buttons must have `overflow-x-auto` on the container and `whitespace-nowrap` on each button, even if it "fits fine" on desktop.
- **Flat tab strips over ~6 items are hard to use on mobile** (session 46) — Properties (17 tabs), Finance (11), HR (9) were single horizontally-scrolling rows; users had to blind-swipe to find e.g. "Renewals" or "Approvals". Pattern now used on all three: group tabs into 3-5 short sections, render a section-pill row + a shorter sub-tab row for the active section (see `Properties.tsx` `GROUPS` const for the reference implementation). Apply this once a page's tab count exceeds ~6-7.
- **Form grids inside modals**: `grid-cols-2` is fine at modal width (~380px) — do not add breakpoints to modal-internal form field pairs
