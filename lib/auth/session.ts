import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  PREVIEW_COOKIE,
  isAppRole,
  isPreviewRole,
  projectionFor,
  type DataProjection,
  type Permission,
  type PreviewRole,
} from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/database";

export type CompanySettings = {
  companyName: string;
  companyTagline: string | null;
  companyLogoUrl: string | null;
  currencyCode: string;
  currencyDecimals: number;
  timezone: string;
  defaultLocale: "en" | "ar";
  reportFooter: string | null;
  idleTimeoutMinutes: number;
};

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
  themePreference: "light" | "dark" | "system";
  locale: "en" | "ar";
  /** The user's real permissions (from the database). */
  permissions: ReadonlySet<Permission>;
  /** Active "View As" preview, if any. Only ever narrows what is shown. */
  previewRole: PreviewRole | null;
  /** Role whose interface is rendered (preview role or real role). */
  effectiveRole: AppRole;
  /** Permissions the rendered interface uses (the previewed role's, when previewing). */
  effectivePermissions: ReadonlySet<Permission>;
  /** Which data projection the rendered interface uses. */
  projection: DataProjection | null;
  settings: CompanySettings;
};

type ContextPayload = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  theme_preference: "light" | "dark" | "system";
  locale: "en" | "ar";
  permissions: string[];
  settings: {
    company_name: string;
    company_tagline: string | null;
    company_logo_url: string | null;
    currency_code: string;
    currency_decimal_places: number;
    timezone_name: string;
    default_locale: "en" | "ar";
    report_footer: string | null;
    idle_timeout_minutes: number;
  } | null;
};

const DEFAULT_SETTINGS: CompanySettings = {
  companyName: "شركة الاسناد لتجارة الهاتف النقال",
  companyTagline: "Mobile Phone Trading",
  companyLogoUrl: null,
  currencyCode: "IQD",
  currencyDecimals: 0,
  timezone: "Asia/Baghdad",
  defaultLocale: "en",
  reportFooter: null,
  idleTimeoutMinutes: 60,
};

/**
 * Resolves the signed-in user, their profile, real permissions and the
 * optional role preview. Memoised per request with React `cache`.
 * Returns null for signed-out requests.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  // Sessions are per request: opt out of prerendering before anything (the
  // Supabase client reads the clock to validate tokens).
  await connection();
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) return null;

  const { data, error } = await supabase.rpc("my_context");
  if (error) throw error;
  const ctx = data as ContextPayload | null;
  if (!ctx || !isAppRole(ctx.role)) return null;

  const permissions = new Set(ctx.permissions as Permission[]);
  const cookieStore = await cookies();
  const requestedPreview = cookieStore.get(PREVIEW_COOKIE)?.value;
  const previewRole =
    permissions.has("roles.preview") && isPreviewRole(requestedPreview) && requestedPreview !== ctx.role
      ? requestedPreview
      : null;

  // In preview, the INTERFACE follows the previewed role's permissions. This is
  // presentation only: every query still runs with the user's real JWT (so the
  // database never returns more than the real user may see), and every write
  // is refused while previewing (lib/auth/guard.ts).
  let effectivePermissions: ReadonlySet<Permission> = permissions;
  if (previewRole) {
    const { data: previewKeys } = await supabase.rpc("role_permission_keys", { p_role: previewRole });
    effectivePermissions = new Set((previewKeys ?? []) as Permission[]);
  }

  const s = ctx.settings;
  return {
    userId: ctx.id,
    email: ctx.email,
    fullName: ctx.full_name,
    role: ctx.role,
    isActive: ctx.is_active,
    themePreference: ctx.theme_preference,
    locale: ctx.locale,
    permissions,
    previewRole,
    effectiveRole: previewRole ?? ctx.role,
    effectivePermissions,
    projection: projectionFor(effectivePermissions),
    settings: s
      ? {
          companyName: s.company_name,
          companyTagline: s.company_tagline,
          companyLogoUrl: s.company_logo_url,
          currencyCode: s.currency_code,
          currencyDecimals: s.currency_decimal_places,
          timezone: s.timezone_name,
          defaultLocale: s.default_locale,
          reportFooter: s.report_footer,
          idleTimeoutMinutes: s.idle_timeout_minutes,
        }
      : DEFAULT_SETTINGS,
  };
});

/** For pages: signed-in and active, otherwise redirect. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isActive) redirect("/inactive");
  return session;
}

/** True when the interface currently rendered may use `permission`. */
export function can(session: SessionContext, permission: Permission) {
  return session.effectivePermissions.has(permission);
}

/** True when the user really holds `permission` (ignores preview). */
export function canReally(session: SessionContext, permission: Permission) {
  return session.permissions.has(permission);
}

/** Serializable subset passed to Client Components. */
export type ClientSession = {
  userId: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  previewRole: PreviewRole | null;
  effectiveRole: AppRole;
  permissions: Permission[];
  effectivePermissions: Permission[];
  projection: DataProjection | null;
  themePreference: "light" | "dark" | "system";
  locale: "en" | "ar";
  settings: CompanySettings;
};

export function toClientSession(s: SessionContext): ClientSession {
  return {
    userId: s.userId,
    email: s.email,
    fullName: s.fullName,
    role: s.role,
    previewRole: s.previewRole,
    effectiveRole: s.effectiveRole,
    permissions: [...s.permissions],
    effectivePermissions: [...s.effectivePermissions],
    projection: s.projection,
    themePreference: s.themePreference,
    locale: s.locale,
    settings: s.settings,
  };
}
