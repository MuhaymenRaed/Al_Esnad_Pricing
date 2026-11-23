# Deployment guide

From an empty Supabase project to a production site on Netlify. Follow the steps in order; each ends with a check.

| | |
|---|---|
| Supabase project | `bfbkehxaghvuimmzjiho` (`https://bfbkehxaghvuimmzjiho.supabase.co`) |
| Hosting | Netlify (official Next.js runtime) |
| E-mail | Brevo transactional SMTP, configured **inside Supabase Auth** |

---

## 1. Supabase project

Already created. For a new environment (e.g. staging): **supabase.com → New project**, region close to Iraq (e.g. *Frankfurt*), strong database password stored in a password manager.

## 2. Database migrations

Six SQL files, applied **in order**:

| File | What it is |
|---|---|
| `supabase/migrations/20261116130000_alesnad_backend.sql` | The company baseline backend (tables, pricing trigger, RLS, views, guarded RPCs). **Already applied** to the production project. |
| `supabase/migrations/20261117090000_app_extensions.sql` | Additive app layer: search engine with cursor pagination/facets/statistics, dashboards, atomic device save, preference columns, invitation audit entries, and two security fixes (see `docs/SECURITY.md`). Idempotent. |
| `supabase/migrations/20261120120000_device_delete.sql` | Permanent device deletion: the `devices.delete` permission (Administrators; can be granted to Pricing Managers; locked off for Viewers and Data Entry) and the guarded `delete_devices()` function. Deletions are recorded in the audit log. Idempotent. |
| `supabase/migrations/20261121090000_price_sync.sql` | Selling-price sync to alisnad.iq and ERPNext: `devices.erp_item_code` (unique link key), the `price_sync_jobs` outbox filled by triggers on every price change / approval / link of an active linked device, `request_price_sync()` for “Sync now”, and `save_device()` storing the item code. **Already applied** to the production project; its automatic triggers are removed again by 20261121150000. Idempotent. |
| `supabase/migrations/20261121120000_price_sync_link_codes.sql` | Several *link codes* per device (`device_link_codes`, each code owned by one device) instead of a single item code. Each code is looked up in both systems. Carries existing single codes (`devices.erp_item_code`) over — the 212 imported devices are linked to their ERPNext items (DEV-…) this way. Idempotent. |
| `supabase/migrations/20261121150000_price_sync_manual.sql` | **Publishing on request only**: removes the automatic sync triggers; adds `device_sync_state` (what ERPNext / alisnad.iq hold per device, for the status badges), the permission `prices.publish` (Administrators; can be granted to Pricing Managers), `request_price_syncs()` (Publish), `link_devices()` (link by exact name) and `import_erp_devices()` (Import from ERPNext). Idempotent. |

**Dashboard (current workflow):** SQL Editor → *New query* → paste the file → *Run*. Run them in the order above.

**CLI alternative:** `npx supabase link --project-ref bfbkehxaghvuimmzjiho` then `npx supabase db push`.

Optional: `supabase/seed.sql` adds the 18 mobile phone and tablet brands, 3 categories (Smartphones, Feature phones, Tablets) and 5 priced example devices (active). Run it in the SQL Editor like the migrations; it is safe to re-run and never changes brands, categories or devices that already exist. Archive the example devices once real ones are entered (if you delete them instead, re-running the seed adds them again).

A database seeded with the first version of the seed (which also had accessory brands and categories) is trimmed with `supabase/remove-accessories.sql`: run it once in the SQL Editor, then run `seed.sql` again. Anything a real device still uses is deactivated instead of deleted.

✅ *Check:* SQL Editor → `select proname from pg_proc where proname in ('search_devices','search_catalog','my_context');` returns three rows.

## 3. Authentication settings

**Authentication → Sign In / Providers**
- **Allow new users to sign up: OFF** (critical — accounts are created only by administrators).
- Email provider: enabled. Confirm email: on.
- Anonymous sign-ins: off.

**Authentication → URL Configuration**
- **Site URL:** `https://<your-netlify-domain>` (e.g. `https://pricing.alisnad.iq`).
- **Redirect URLs** (add each):
  - `https://<your-domain>/auth/confirm`
  - `https://<your-domain>/auth/callback`
  - `http://localhost:3000/auth/confirm` and `http://localhost:3000/auth/callback` (development)
  - Netlify previews (optional): `https://deploy-preview-*--<site-name>.netlify.app/auth/*`

**Authentication → Policies / Passwords:** minimum length 10, require lowercase + uppercase + digits; enable leaked-password protection if your plan offers it.

**Authentication → Sessions (recommended):** JWT expiry 3600 s, refresh-token rotation on. The app additionally signs users out after the inactivity timeout configured in *Settings → Security*.

✅ *Check:* `curl https://bfbkehxaghvuimmzjiho.supabase.co/auth/v1/settings -H "apikey: <anon key>"` shows `"disable_signup": true`. The app's *Settings → Security* tab shows the same check live.

## 4. Brevo SMTP (all authentication e-mail)

All Auth e-mail — invitations, confirmations, password recovery, e-mail change — is sent by Supabase through Brevo. SMTP credentials live **only** in the Supabase dashboard; the web app never sees them.

1. **Brevo → Senders, Domains & Dedicated IPs → Domains → Add a domain** (e.g. `alisnad.iq`). Add the DKIM, DMARC and Brevo-code DNS records it shows at your DNS provider, then *Verify*. Authenticated domains are required for reliable delivery.
2. **Brevo → Senders → Add a sender:** e.g. `no-reply@alisnad.iq`, name *Al-Esnad Pricing*. Verify it.
3. **Brevo → SMTP & API → SMTP:** note the *SMTP server* (`smtp-relay.brevo.com`), *Port* (`587`), *Login*, and generate an **SMTP key**.
4. **Supabase → Authentication → Emails → SMTP Settings → Enable custom SMTP:**

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@alisnad.iq` (the verified Brevo sender) |
   | Sender name | `Al-Esnad Pricing` |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | your Brevo SMTP login |
   | Password | the Brevo SMTP key |
   | Minimum interval | 60 seconds |

5. **Supabase → Authentication → Rate Limits:** raise *emails per hour* (e.g. 60) — the default limit is very low.
6. **Supabase → Authentication → Emails → Templates:** for each template paste the HTML from `supabase/templates/` and set the subject:

   | Template | File | Subject |
   |---|---|---|
   | Invite user | `invite.html` | You're invited to Al-Esnad Pricing |
   | Reset password | `recovery.html` | Reset your Al-Esnad Pricing password |
   | Confirm signup | `confirmation.html` | Confirm your e-mail for Al-Esnad Pricing |
   | Change email address | `email_change.html` | Confirm your new e-mail address |
   | Magic link | `magic_link.html` | Your Al-Esnad Pricing sign-in link |

   The templates use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`, which the app verifies on the server. (The default templates also work: their links are completed by `/auth/callback`.) Custom templates require custom SMTP on the Free plan — another reason to configure Brevo first.

✅ *Check:* invite yourself a test account from *Administration → Users*; the e-mail arrives from the Brevo sender, and the link opens “Welcome — set your password”.

## 5. Environment variables

| Variable | Where | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Netlify + `.env.local` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Netlify + `.env.local` | no (browser key, protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Netlify + `.env.local` | **yes — server only** |
| `NEXT_PUBLIC_SITE_URL` | Netlify + `.env.local` | no |
| `ALISNAD_SUPABASE_URL`, `ALISNAD_SUPABASE_SERVICE_ROLE_KEY` | Netlify + `.env.local` | **yes — server only** (price sync to alisnad.iq) |
| `ERPNEXT_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET` | Netlify + `.env.local` | **yes — server only** (ERPNext) |
| `ERPNEXT_COMPANY` (*الاسناد* — the only company whose Items are ever read or priced; required), `ERPNEXT_SELLING_PRICE_LIST` (*الاسناد*), `ERPNEXT_BUYING_PRICE_LIST` (*Standard Buying*), `ERPNEXT_ITEM_GROUPS` (*الأجهزة* — new devices only; used devices are not imported) | Netlify + `.env.local` | no (configuration) |

See `.env.example`. Never prefix the service key with `NEXT_PUBLIC_`; the module that reads it (`lib/supabase/admin.ts`) is `server-only`, so importing it from client code fails the build.

**ERPNext and alisnad.iq.** The three systems share one key per device: its *link codes* (device form → More details), normally the ERPNext item code (e.g. `DEV-000118`) plus, when needed, the alisnad.iq product code (`products.erp_item_code`, e.g. `ERPN-A6453C287A`). Each code is looked up in both systems.

- **Only Al-Esnad items**: ERPNext is shared with other companies; every Item request is limited to the company in `ERPNEXT_COMPANY` (its Item Defaults), so other companies' items are never imported, linked, checked or priced. Without that variable ERPNext is not used.
- **Import from ERPNext** (Devices page, Administrators / Pricing Managers): reads the Items of the groups in `ERPNEXT_ITEM_GROUPS` with their purchase price — from `ERPNEXT_BUYING_PRICE_LIST` once a device has been published, before that the price the Item was created with in `ERPNEXT_SELLING_PRICE_LIST` — sorts each by its name into brand and category (phones and tablets only — gifts, accessories, watches and disabled items are skipped, unknown brands are listed for manual entry) and shows a review. Only after the admin confirms are devices created — *Pending review*, purchase price from ERPNext, discount / payback / profit 0 — or linked to an existing device of the same name. Purchase prices of already-linked devices are replaced only when ticked.
- **Status badges**: every device row shows *ERP* and *Site* badges — Published, Price differs, Hidden, Not found, Not linked — from the last check or publish. *Check* (device page, or a selection) re-reads both systems; nothing changes there.
- **Publish** (device page or a selection / *Select all*): reads both systems, lists every price that would change (now → after), and publishes only after the admin ticks the confirmation. alisnad.iq receives the final selling price (`products.base_price`); ERPNext receives the final selling price in `ERPNEXT_SELLING_PRICE_LIST` (*الاسناد*) and the purchase price in `ERPNEXT_BUYING_PRICE_LIST` (*Standard Buying*). The two must be different lists (ERPNext keeps one general price per item and list); `none` turns either off. Only approved (active), linked, priced devices are sent. Saving, approving or re-pricing a device never changes either system.

The ERPNext API user needs read access to *Item* and *Price List* and read/write/create on *Item Price*.

> **Key hygiene:** if a service-role key was ever shared in chat, e-mail or a ticket, rotate it (Project Settings → API keys) before going live, and update Netlify.

## 6. First administrator

Option A — script (recommended):

```bash
npm run create-admin -- owner@alisnad.iq "Owner Name"              # sends an invitation via Brevo
npm run create-admin -- owner@alisnad.iq "Owner Name" --password   # no e-mail; prompts for a password
```

Option B — dashboard: *Authentication → Users → Invite user* (or *Add user*), then in the SQL Editor:

```sql
update public.profiles
set role = 'administrator', is_active = true
where lower(email) = lower('owner@alisnad.iq');
```

Everyone else is added from the app (**Users → Add user**). You can either **create the account with a password** (active immediately, so no e-mail is needed) or **send an e-mail invitation**. Both assign the role and record the action in the audit log. Both need `SUPABASE_SERVICE_ROLE_KEY` set on the server.

✅ *Check:* sign in → the title reads **Administrator Dashboard** and the *Administration* menu is visible.

## 7. Netlify

1. Push the repository to GitHub/GitLab.
2. **Netlify → Add new site → Import an existing project** → choose the repository. Netlify detects Next.js; `netlify.toml` pins the build (`npm run build`, Node 24, `@netlify/plugin-nextjs`).
3. **Site configuration → Environment variables:** add the variables from §5 (scope: *Builds* and *Functions*).
4. Deploy. Then set your custom domain (**Domain management**) and enable HTTPS.
5. Update Supabase *Site URL* / *Redirect URLs* (§3) and `NEXT_PUBLIC_SITE_URL` to the final domain, then redeploy.

PDF fonts in `assets/fonts` are bundled into the report function via `outputFileTracingIncludes` in `next.config.ts`.

## 8. Production smoke test

Work through `docs/TESTING.md` §2 (ten acceptance scenarios) with four real accounts — one per role. Minimum before announcing the system:

- [ ] iPhone 18 example → final cost **2,762,000**, selling price **2,812,000**.
- [ ] Viewer sees only name/brand/category/selling price; *Settings → Security* shows all checks green.
- [ ] Invitation and password-reset e-mails arrive from the Brevo sender.
- [ ] A Viewer PDF contains no purchase/discount/payback/profit values.
- [ ] Deactivating a user removes their access on their next click.
