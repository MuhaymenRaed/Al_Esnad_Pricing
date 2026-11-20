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

Two SQL files, applied **in order**:

| File | What it is |
|---|---|
| `supabase/migrations/20261116130000_alesnad_backend.sql` | The company baseline backend (tables, pricing trigger, RLS, views, guarded RPCs). **Already applied** to the production project. |
| `supabase/migrations/20261117090000_app_extensions.sql` | Additive app layer: search engine with cursor pagination/facets/statistics, dashboards, atomic device save, preference columns, invitation audit entries, and two security fixes (see `docs/SECURITY.md`). Idempotent. |

**Dashboard (current workflow):** SQL Editor → *New query* → paste the file → *Run*. Run the baseline first on a fresh project, then the extension.

**CLI alternative:** `npx supabase link --project-ref bfbkehxaghvuimmzjiho` then `npx supabase db push`.

Optional: `supabase/seed.sql` creates starter brands and categories (no devices, no prices).

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

See `.env.example`. Never prefix the service key with `NEXT_PUBLIC_`; the module that reads it (`lib/supabase/admin.ts`) is `server-only`, so importing it from client code fails the build.

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
3. **Site configuration → Environment variables:** add the four variables from §5 (scope: *Builds* and *Functions*).
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
