# Testing

## 1. Automated

```bash
npm test            # everything (≈7 s)
npm run test:db     # database security & pricing only
npm run typecheck   # route types + TypeScript
npm run lint
npm run build
```

| Suite | What it proves |
|---|---|
| `tests/db/*` | Runs the **real migrations** (baseline + extension) in an in-process PostgreSQL (PGlite) with Supabase's `auth` schema, `anon`/`authenticated` roles and JWT claims emulated. Every query runs as a specific user exactly as through the Supabase API, so RLS, grants and function checks are genuinely exercised. |
| `lib/pricing/*.test.ts` | Decimal pricing engine (live preview) — same results and rounding as the database trigger. |
| `lib/filters/*.test.ts` | URL ⇄ filter model, permission sanitising, time-zone date windows. |
| `features/reports/*.test.tsx` | Brand sections, exact totals, Viewer report column restriction, PDF rendering and metadata. |

## 2. Acceptance scenarios

Each scenario lists the automated test that covers the database/server part and the manual check for the UI.

| # | Scenario | Automated coverage | Manual check |
|---|---|---|---|
| 1 | **Pricing calculations** — 2,800,000 · 1 % · 10,000 payback · 50,000 profit → cost **2,762,000**, selling **2,812,000** | `pricing.test.ts` › *reproduces the iPhone 18 reference example*; `calculate.test.ts` | *Devices → New device*: type the values; the live panel shows 28,000 / 2,762,000 / 2,812,000; save → toast “confirmed by the database”. |
| 2 | **Viewer security** — direct API requests for private values fail | `security.test.ts` › *Scenario 2* (direct table reads denied, manager view empty, full RPCs refused, numeric/metadata search can't leak, writes denied) | Sign in as Viewer: table shows Device · Brand · Category · Final selling price. In DevTools run `fetch('/api/devices?view=full')` → **403**. With the anon key, `GET /rest/v1/device_financials` → `permission denied`. |
| 3 | **Data Entry security** | `security.test.ts` › *Scenario 3* | Sign in as Data Entry: submit a device with purchase price → confirmation screen; the form has no discount/payback/profit fields; *My submissions* shows status only. |
| 4 | **Pricing Manager** | `security.test.ts` › *Scenario 4*; `pricing.test.ts` | Edit a device: all four inputs editable; live preview updates on each keystroke; approve a pending submission. Use **View as → Viewer** and confirm the banner and restricted columns. |
| 5 | **Administrator** | `admin.test.ts` (invite → role, inactive non-invited accounts, role change, deactivation, self-change blocked, last admin kept, locked permissions, audit log) | Invite a user (e-mail via Brevo), change role, deactivate, toggle a permission on *Roles & permissions*, read *Audit logs*. |
| 6 | **Filtering** — Apple + price range | `search.test.ts` › *Scenario 6* | Devices: Brand = Apple, Price 2,000,000–3,500,000 → only matching Apple devices; chips show both filters; URL contains `brand=…&min=…&max=…`. |
| 7 | **PDF — 2 Apple + 1 Samsung selected** | `search.test.ts` › *Selection export scope*; `report.test.tsx` › *separates brands…* | Select two Apple and one Samsung device → *Print selected* → preview shows 3 devices in an Apple and a Samsung section. |
| 8 | **Filtered PDF incl. not-yet-loaded rows** | `search.test.ts` › *Cursor pagination* (server walks every page); report route uses `fetchAllDevices` | With > 50 matching devices, apply filters without scrolling → *Print filtered results* → record count in the preview equals the “Showing … of N” total. |
| 9 | **Viewer PDF contains no private data** | `report.test.tsx` › *Viewer report cells…*, *private-data-free metadata*; `security.test.ts` (catalogue projection has no private columns) | As Viewer, generate a PDF; open *Document properties* → only title/company/subject. |
| 10 | **Responsive & themes** | — | Check desktop (1440 px), tablet (768 px) and mobile (390 px); switch Light/Dark/System and العربية (RTL) from the user menu. |

## 3. Test accounts

Create one account per role (Administration → Users → Invite). Use real mailboxes so invitations exercise the Brevo SMTP path. Never reuse production accounts for testing.
