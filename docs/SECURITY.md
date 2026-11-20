# Security model

> The same database produces different data for each role. Every rule below is enforced by **PostgreSQL** (grants, Row Level Security, `SECURITY DEFINER` functions with explicit permission checks). The Next.js UI only *hides* what the database already refuses to return.

## Layers

1. **Proxy (`proxy.ts`)** — refreshes the Supabase session and redirects signed-out visitors. Optimistic only; never relied on for authorisation.
2. **Server Components / Server Actions / Route Handlers** — re-read the session from cookies on every request (`lib/auth/session.ts`, `lib/auth/guard.ts`), check the user's *real* permissions, validate all input with Zod, and refuse writes during role preview.
3. **Database (authoritative)**
   - `anon` has no privileges. `authenticated` has **no direct SELECT** on `devices`, `device_financials` or `device_public_pricing`.
   - Data is read through projections that check `has_permission()` for the caller's JWT:
     - `search_devices` / `device_summary` / `get_managed_device` — full financial projection (`devices.read_all` + `financials.read`).
     - `search_catalog` / `catalog_summary` / `get_catalog_device` — Viewer projection. Returns **only** name, brand, category, approved selling price and dates; never touches `device_financials`. Viewer search cannot filter, sort or numerically match on private amounts, metadata or SKU (so search results can't leak private values indirectly).
     - `my_submissions` — Data Entry projection (own records, no financial fields).
   - All writes go through guarded functions (`save_device`, `submit_device`, `update_device_*`, `set_device_status`, `admin_*`) or RLS-checked tables (`brands`, `categories`, `company_settings`, `role_permissions`).
   - Pricing values are computed by the `calculate_device_financials` trigger with exact `numeric` arithmetic; client-supplied computed values are impossible to write.
   - Every `SECURITY DEFINER` function sets `search_path = ''`, schema-qualifies objects, and has `EXECUTE` revoked from `PUBLIC`/`anon`.

## Role / permission matrix (defaults)

✓ granted · — not granted · 🔒 locked (cannot be changed in the app)

| Permission | Administrator | Pricing Manager | Viewer | Data Entry |
|---|:-:|:-:|:-:|:-:|
| devices.read_all | ✓🔒 | ✓🔒 | —🔒 | —🔒 |
| devices.read_public (catalogue) | ✓🔒 | — | ✓ | — |
| pricing.read_public (selling price) | ✓🔒 | ✓ | ✓ | — |
| devices.create / update / archive | ✓🔒 | ✓ | —🔒 | —🔒 |
| devices.submit | ✓🔒 | — | — | ✓ |
| devices.read_own_submissions | ✓🔒 | — | — | ✓ |
| devices.edit_own_submissions | ✓🔒 | — | — | — (admin may enable) |
| **financials.read** | ✓🔒 | ✓🔒 | —🔒 | —🔒 |
| **financials.update** | ✓🔒 | ✓🔒 | —🔒 | —🔒 |
| submissions.review | ✓🔒 | ✓ | —🔒 | —🔒 |
| reports.export | ✓🔒 | ✓ | ✓ | — (admin may enable) |
| brands.read / categories.read | ✓🔒 | ✓ | ✓ | ✓ |
| brands.manage / categories.manage | ✓🔒 | — (admin may enable) | — | — |
| roles.preview (“View As”) | ✓🔒 | ✓ | —🔒 | —🔒 |
| users.manage / roles.manage / audit.read / settings.manage | ✓🔒 | —🔒 | —🔒 | —🔒 |

Administrators implicitly hold every permission (`has_permission()`), so they can never be locked out. Locks are enforced by the `role_permissions_guard` trigger — even a direct API call by an administrator cannot give a Viewer financial access.

## Account lifecycle

- **Public sign-up must be disabled** in Supabase Auth. Defence in depth: accounts created without an invitation start **inactive** and receive no data.
- Invitations: Auth Admin API (service key, server-only) → profile created by trigger → role assigned with the admin's own session (`admin_set_user_role`, audited) → `USER_INVITED` audit entry.
- Nobody can change their own role or deactivate themselves; the last active administrator cannot be demoted or deactivated.
- Deactivation takes effect immediately (`is_active = false` denies every RLS check and RPC) and the Auth user is banned to stop new sessions.
- Idle sessions are signed out after the company-configured timeout; a sign-out in one tab signs out all tabs.

## View As (role preview)

A cookie (only honoured for users holding `roles.preview`) selects which role's *interface* is rendered. It is presentation only and never impersonation: every query still runs with the user's **real** JWT through the previewed role's restricted projection (e.g. a Viewer preview reads `search_catalog`, which cannot return private columns), every Server Action refuses writes while previewing, and a prominent banner shows the preview state.

## Reports

`POST /api/reports` re-authorises with real permissions, rebuilds the **complete** result set server-side from the requested scope (filtered / selected / brands / all — never from browser state), and reads only the projection matching the report type. Viewer PDFs are built from `search_catalog`, so private values are physically absent; PDF metadata contains only title, company and subject.

## Audit log

Append-only: `authenticated` has `SELECT` only (admins by default via `audit.read`); no role can update or delete entries. Recorded: device/pricing/brand/category/permission/settings changes (with before/after), role changes, activations/deactivations, invitations.

## Changes made to the baseline (additive migration)

1. `handle_auth_user_profile()` now creates **inactive** profiles unless the Auth user was invited (`invited_at`), closing the “open sign-up ⇒ active Viewer” gap.
2. A guard trigger locks mandatory cells of the permission matrix (financial and administrative permissions can never be granted to Viewers/Data Entry; Pricing Managers keep core pricing access and never receive user/role/settings/audit rights).
3. A guard trigger prevents anyone from changing their own role or activation state.
