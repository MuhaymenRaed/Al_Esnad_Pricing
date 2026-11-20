# Al-Esnad Pricing

Device pricing, cost management and selling-price management for **Al-Esnad Company — Mobile Phone Trading** (شركة الاسناد لتجارة الهاتف النقال).

One device database, four interfaces. Each role sees exactly the data PostgreSQL allows it to see:

| Role | Interface |
|---|---|
| **Administrator** | Administrator Dashboard, users & invitations, roles & permissions, audit logs, company & security settings, everything below |
| **Pricing Manager** | Pricing Management: purchase price, discount, payback, final cost, profit, selling price; review submissions; financial PDF reports; **View As** Viewer / Data Entry |
| **Viewer** | Device Catalogue: device, brand, category, **final selling price only** |
| **Data Entry Operator** | Data Entry: submit name, brand, category, official purchase price, optional SKU/model/attributes |

**Pricing** (computed in the database with exact decimals, previewed live in the form):

```
Discount amount = Purchase price × Discount % ÷ 100   (or the fixed amount)
Final cost      = Purchase price − Discount amount − Payback
Selling price   = Final cost + Company profit
```

iPhone 18 check: 2,800,000 − 28,000 − 10,000 = **2,762,000**; + 50,000 = **2,812,000 IQD**.

## Stack

Next.js 16 (App Router, Cache Components / Partial Prerendering, Proxy) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · Supabase (Postgres, Auth, RLS) · Brevo SMTP via Supabase Auth · @react-pdf/renderer · TanStack Query & Virtual · Zod · decimal.js · Netlify.

## Quick start

```bash
cp .env.example .env.local      # fill in Supabase URL + keys
npm install
npm run dev                      # http://localhost:3000
```

Database: apply both files in `supabase/migrations/` (SQL Editor or `supabase db push`), then create the first administrator with `npm run create-admin -- you@alisnad.iq "Your Name"`.

## Language, theme and users

- **English / العربية.** Every screen is translated. Switch with the language toggle in the sidebar (or on the sign-in page) or under *Settings → Appearance*. Arabic flips the whole interface to right-to-left. The choice is saved in a `locale` cookie and on the user's profile. Text lives in `messages/en.ts` (the source of keys) and `messages/ar.ts`, and TypeScript fails the build if a key is missing from either file. Server code uses `getT()` from `lib/i18n/server`, client code uses `useI18n()` from `lib/i18n/client`, and server actions return translation keys rather than English text. PDF reports stay in English.
- **Light / dark / system** via `next-themes` (light is the default). It is saved to the profile, so it follows the user to other devices.
- **Adding users** (administrators: *Users → Add user*, or the *Add user* button in the sidebar), in one of two ways:
  - **Create with password**: the account is created and active immediately. A strong password is generated (or you type one), you copy it and hand it to the employee, and they can sign in straight away. This needs no e-mail delivery.
  - **Send e-mail invitation**: the employee gets a link (sent through Brevo SMTP) and sets their own password.
  
  Either way you pick the role up front. Afterwards you can change the role, rename the user, set a new password, deactivate or reactivate the account, or resend or revoke a pending invitation. Every action is written to the audit log.

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase, migrations, Auth, **Brevo SMTP**, redirect URLs, environment variables, first administrator, Netlify, production checks.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security architecture and the role/permission matrix.
- [`docs/TESTING.md`](docs/TESTING.md) — automated tests and the ten acceptance scenarios.

## Project structure

```
app/                      routes (auth pages, (app) pages, api/devices, api/reports, auth/confirm|callback)
components/ui/            shadcn/ui primitives
components/{common,layout,filters,tables,forms,pdf,brand,providers}/
features/{auth,devices,catalogue,reports,users,audit,settings,session}/   data access, server actions, feature UI
lib/{supabase,auth,permissions,pricing,filters,validation,i18n}/          shared logic
hooks/                    client hooks (URL filters, infinite query, debounce)
types/database.ts         typed Supabase schema
supabase/migrations/      baseline + app extension (SQL)
supabase/templates/       branded Auth e-mail templates (Brevo)
tests/db/                 database security tests (real migrations in PGlite)
scripts/create-admin.mjs  first-administrator bootstrap
```

## Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | all tests · `npm run test:db` database only |
| `npm run typecheck` / `lint` | static checks |
| `npm run create-admin -- <email> "<name>" [--password]` | bootstrap the first administrator |
| `npm run db:types` | regenerate `types/database.ts` from the live schema (Supabase CLI) |
