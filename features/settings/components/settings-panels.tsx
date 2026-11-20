"use client";

import { AlertTriangle, CheckCircle2, KeyRound, Monitor, Moon, Save, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMounted } from "@/hooks/use-mounted";
import { savePreferencesAction, updateProfileAction } from "@/features/session/actions";
import { changePasswordAction, updateCompanySettingsAction } from "@/features/settings/actions";
import type { CompanySettings } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n/client";
import type { Locale, MessageKey } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types/database";

type FieldErrors = Record<string, string[] | undefined>;

export type SecurityCheck = { label: MessageKey; ok: boolean; detail: MessageKey };

function useErr(errors: FieldErrors | undefined) {
  const { tm } = useI18n();
  return (k: string) => errors?.[k]?.map((m) => ({ message: tm(m) }));
}

export function SettingsPanels({
  profile,
  company,
  canManageCompany,
  securityChecks,
  readOnly,
}: {
  profile: { fullName: string; email: string; role: AppRole };
  company: CompanySettings;
  canManageCompany: boolean;
  securityChecks: SecurityCheck[];
  readOnly: boolean;
}) {
  const { t } = useI18n();
  return (
    <Tabs defaultValue="profile" className="gap-6">
      <TabsList className="flex-wrap">
        <TabsTrigger value="profile">{t("settings.tabs.profile")}</TabsTrigger>
        <TabsTrigger value="appearance">{t("settings.tabs.appearance")}</TabsTrigger>
        {canManageCompany ? <TabsTrigger value="company">{t("settings.tabs.company")}</TabsTrigger> : null}
        {canManageCompany ? <TabsTrigger value="security">{t("settings.tabs.security")}</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="profile" className="grid max-w-3xl gap-6">
        <ProfileCard profile={profile} readOnly={readOnly} />
        <PasswordCard readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="appearance" className="max-w-3xl">
        <AppearanceCard />
      </TabsContent>
      {canManageCompany ? (
        <TabsContent value="company" className="max-w-3xl">
          <CompanyCard company={company} readOnly={readOnly} />
        </TabsContent>
      ) : null}
      {canManageCompany ? (
        <TabsContent value="security" className="grid max-w-3xl gap-6">
          <SecurityCard company={company} checks={securityChecks} readOnly={readOnly} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function ProfileCard({ profile, readOnly }: { profile: { fullName: string; email: string; role: AppRole }; readOnly: boolean }) {
  const { t, tm } = useI18n();
  const [name, setName] = useState(profile.fullName);
  const [pending, startTransition] = useTransition();
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("settings.profile")}</CardTitle>
        <CardDescription>{t("settings.profileDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="profile-name">{t("settings.fullName")}</FieldLabel>
            <Input id="profile-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("settings.email")}</FieldLabel>
              <Input value={profile.email} dir="ltr" disabled />
            </Field>
            <Field>
              <FieldLabel>{t("settings.role")}</FieldLabel>
              <Input value={t(`roles.${profile.role}`)} disabled />
              <FieldDescription>{t("settings.roleHint")}</FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={pending || readOnly || name.trim() === profile.fullName}
          onClick={() =>
            startTransition(async () => {
              const result = await updateProfileAction(name);
              if (result.ok) toast.success(tm(result.message));
              else toast.error(tm(result.error));
            })
          }
        >
          {pending ? <Spinner /> : <Save />} {t("settings.saveProfile")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PasswordCard({ readOnly }: { readOnly: boolean }) {
  const { t, tm } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>();
  const err = useErr(errors);
  const [pending, startTransition] = useTransition();
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> {t("settings.password")}
        </CardTitle>
        <CardDescription>{t("settings.passwordDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors?.password) || undefined}>
          <FieldLabel htmlFor="new-password">{t("auth.newPassword")}</FieldLabel>
          <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={readOnly} />
          <FieldError errors={err("password")} />
        </Field>
        <Field data-invalid={Boolean(errors?.confirm) || undefined}>
          <FieldLabel htmlFor="confirm-password">{t("auth.confirmPassword")}</FieldLabel>
          <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={readOnly} />
          <FieldError errors={err("confirm")} />
        </Field>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          variant="outline"
          disabled={pending || readOnly || !password}
          onClick={() =>
            startTransition(async () => {
              setErrors(undefined);
              const result = await changePasswordAction({ password, confirm });
              if (result.ok) {
                toast.success(tm(result.message));
                setPassword("");
                setConfirm("");
              } else {
                setErrors(result.fieldErrors);
                toast.error(tm(result.error));
              }
            })
          }
        >
          {pending ? <Spinner /> : null} {t("settings.changePassword")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function AppearanceCard() {
  const { t, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [, startTransition] = useTransition();
  const mounted = useMounted();
  const options = [
    { value: "light", label: t("theme.light"), icon: <Sun className="size-5" /> },
    { value: "dark", label: t("theme.dark"), icon: <Moon className="size-5" /> },
    { value: "system", label: t("theme.system"), icon: <Monitor className="size-5" /> },
  ] as const;
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("settings.appearance")}</CardTitle>
        <CardDescription>{t("settings.appearanceDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field>
          <FieldLabel>{t("settings.theme")}</FieldLabel>
          <div className="grid grid-cols-3 gap-3">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={mounted && theme === o.value}
                onClick={() => {
                  setTheme(o.value);
                  startTransition(async () => void (await savePreferencesAction({ theme: o.value })));
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors hover:bg-accent",
                  mounted && theme === o.value && "border-brand/40 bg-brand-soft/50 text-brand ring-2 ring-brand/10",
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <Field>
          <FieldLabel>{t("settings.language")}</FieldLabel>
          <div className="grid grid-cols-2 gap-3">
            {(["en", "ar"] as Locale[]).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => startTransition(async () => void (await savePreferencesAction({ locale: l })))}
                className={cn(
                  "rounded-xl border p-4 text-sm font-medium transition-colors hover:bg-accent",
                  locale === l && "border-brand/40 bg-brand-soft/50 text-brand ring-2 ring-brand/10",
                )}
              >
                {l === "en" ? "English" : "العربية"}
              </button>
            ))}
          </div>
          <FieldDescription>{t("settings.languageHint")}</FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}

function CompanyCard({ company, readOnly }: { company: CompanySettings; readOnly: boolean }) {
  const { t, tm } = useI18n();
  const [v, setV] = useState({
    companyName: company.companyName,
    companyTagline: company.companyTagline ?? "",
    companyLogoUrl: company.companyLogoUrl ?? "",
    currencyCode: company.currencyCode,
    currencyDecimals: String(company.currencyDecimals),
    timezone: company.timezone,
    defaultLocale: company.defaultLocale,
    reportFooter: company.reportFooter ?? "",
    idleTimeoutMinutes: String(company.idleTimeoutMinutes),
  });
  const [errors, setErrors] = useState<FieldErrors>();
  const err = useErr(errors);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const scaleChanged = Number(v.currencyDecimals) !== company.currencyDecimals;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("settings.company")}</CardTitle>
        <CardDescription>{t("settings.companyDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(errors?.companyName) || undefined}>
            <FieldLabel htmlFor="c-name">{t("settings.companyName")}</FieldLabel>
            <Input id="c-name" value={v.companyName} onChange={(e) => set({ companyName: e.target.value })} disabled={readOnly} />
            <FieldError errors={err("companyName")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-tagline">{t("settings.tagline")}</FieldLabel>
            <Input id="c-tagline" value={v.companyTagline} maxLength={200} onChange={(e) => set({ companyTagline: e.target.value })} disabled={readOnly} />
          </Field>
          <Field data-invalid={Boolean(errors?.companyLogoUrl) || undefined}>
            <FieldLabel htmlFor="c-logo">{t("settings.logoUrl")}</FieldLabel>
            <Input id="c-logo" type="url" dir="ltr" placeholder="https://…" value={v.companyLogoUrl} onChange={(e) => set({ companyLogoUrl: e.target.value })} disabled={readOnly} />
            <FieldDescription>{t("settings.logoHint")}</FieldDescription>
            <FieldError errors={err("companyLogoUrl")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field data-invalid={Boolean(errors?.currencyCode) || undefined}>
              <FieldLabel htmlFor="c-currency">{t("settings.currency")}</FieldLabel>
              <Input id="c-currency" dir="ltr" value={v.currencyCode} maxLength={3} onChange={(e) => set({ currencyCode: e.target.value.toUpperCase() })} disabled={readOnly} />
              <FieldError errors={err("currencyCode")} />
            </Field>
            <Field>
              <FieldLabel>{t("settings.decimals")}</FieldLabel>
              <Select value={v.currencyDecimals} onValueChange={(x) => set({ currencyDecimals: x })} disabled={readOnly}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["0", "1", "2", "3", "4"].map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={Boolean(errors?.timezone) || undefined}>
              <FieldLabel htmlFor="c-tz">{t("settings.timezone")}</FieldLabel>
              <Input id="c-tz" dir="ltr" value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} disabled={readOnly} />
              <FieldError errors={err("timezone")} />
            </Field>
          </div>
          {scaleChanged ? (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t("settings.scaleWarning")}
            </p>
          ) : null}
          <Field>
            <FieldLabel>{t("settings.defaultLanguage")}</FieldLabel>
            <Select value={v.defaultLocale} onValueChange={(x) => set({ defaultLocale: x as "en" | "ar" })} disabled={readOnly}>
              <SelectTrigger className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-footer">{t("settings.reportFooter")}</FieldLabel>
            <Textarea id="c-footer" rows={2} maxLength={300} value={v.reportFooter} onChange={(e) => set({ reportFooter: e.target.value })} disabled={readOnly} />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={pending || readOnly}
          onClick={() =>
            startTransition(async () => {
              setErrors(undefined);
              const result = await updateCompanySettingsAction({ ...v, currencyDecimals: Number(v.currencyDecimals), idleTimeoutMinutes: Number(v.idleTimeoutMinutes) });
              if (result.ok) toast.success(tm(result.message));
              else {
                setErrors(result.fieldErrors);
                toast.error(tm(result.error));
              }
            })
          }
        >
          {pending ? <Spinner /> : <Save />} {t("settings.saveCompany")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function SecurityCard({ company, checks, readOnly }: { company: CompanySettings; checks: SecurityCheck[]; readOnly: boolean }) {
  const { t, tm } = useI18n();
  const [minutes, setMinutes] = useState(String(company.idleTimeoutMinutes));
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t("settings.securityStatus")}</CardTitle>
          <CardDescription>{t("settings.securityStatusDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                <span>
                  <span className="font-medium">{t(c.label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(c.detail)}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t("settings.sessionPolicy")}</CardTitle>
          <CardDescription>{t("settings.sessionPolicyDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field className="w-56">
            <FieldLabel htmlFor="idle">{t("settings.idleTimeout")}</FieldLabel>
            <Input id="idle" type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={readOnly} />
          </Field>
          <Button
            disabled={pending || readOnly}
            onClick={() =>
              startTransition(async () => {
                const result = await updateCompanySettingsAction({
                  companyName: company.companyName,
                  companyTagline: company.companyTagline ?? "",
                  companyLogoUrl: company.companyLogoUrl ?? "",
                  currencyCode: company.currencyCode,
                  currencyDecimals: company.currencyDecimals,
                  timezone: company.timezone,
                  defaultLocale: company.defaultLocale,
                  reportFooter: company.reportFooter ?? "",
                  idleTimeoutMinutes: Number(minutes),
                });
                if (result.ok) toast.success(t("settings.sessionSaved"));
                else toast.error(tm(result.error));
              })
            }
          >
            {pending ? <Spinner /> : <Save />} {t("common.save")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            <Link href="/roles-and-permissions" className="underline underline-offset-4 hover:text-foreground">
              {t("settings.editSubmissionsNote")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
