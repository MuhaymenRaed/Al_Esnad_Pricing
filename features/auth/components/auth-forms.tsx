"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  requestPasswordResetAction,
  signInAction,
  updatePasswordAction,
  type FormState,
} from "@/features/auth/actions";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const REASON_TONES = { expired: "warning", idle: "info", signed_out: "info", inactive: "warning" } as const;

export function Notice({ tone, children }: { tone: "info" | "warning" | "error" | "success"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "warning" && "border-warning/30 bg-warning-soft text-warning",
        tone === "info" && "border-info/25 bg-info-soft text-info",
        tone === "success" && "border-success/30 bg-success-soft text-success",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="h-11 pe-10" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-lg text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function useFieldErrors(state: FormState) {
  const { tm } = useI18n();
  return (field: string) => {
    const messages = state?.fieldErrors?.[field];
    return messages?.length ? messages.map((m) => ({ message: tm(m) })) : undefined;
  };
}

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const { t, tm } = useI18n();
  const [state, action, pending] = useActionState(signInAction, null);
  const errorsFor = useFieldErrors(state);
  const tone = reason && reason in REASON_TONES ? REASON_TONES[reason as keyof typeof REASON_TONES] : null;

  return (
    <div className="space-y-7">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.signIn")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.signInSubtitle")}</p>
      </header>
      {tone ? <Notice tone={tone}>{t(`auth.reasons.${reason as keyof typeof REASON_TONES}`)}</Notice> : null}
      {state?.error ? <Notice tone="error">{tm(state.error)}</Notice> : null}
      <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(state?.fieldErrors?.email)}>
            <FieldLabel htmlFor="email">{t("auth.workEmail")}</FieldLabel>
            <Input id="email" name="email" type="email" dir="ltr" autoComplete="username" required autoFocus className="h-11" placeholder="name@alesnad.iq" />
            <FieldError errors={errorsFor("email")} />
          </Field>
          <Field data-invalid={Boolean(state?.fieldErrors?.password)}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
              <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {t("auth.forgotPassword")}
              </Link>
            </div>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
            <FieldError errors={errorsFor("password")} />
          </Field>
        </FieldGroup>
        <Button type="submit" size="lg" className="h-11 w-full text-[0.95rem]" disabled={pending}>
          {pending ? <Spinner /> : null}
          {pending ? t("auth.signingIn") : t("auth.signIn")}
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">{t("auth.invitationOnly")}</p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const { t, tm } = useI18n();
  const [state, action, pending] = useActionState(requestPasswordResetAction, null);
  const errorsFor = useFieldErrors(state);
  return (
    <div className="space-y-7">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.resetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.resetSubtitle")}</p>
      </header>
      {state?.success ? <Notice tone="success">{tm(state.success)}</Notice> : null}
      {state?.error ? <Notice tone="error">{tm(state.error)}</Notice> : null}
      <form action={action} className="space-y-5" noValidate>
        <Field data-invalid={Boolean(state?.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">{t("auth.workEmail")}</FieldLabel>
          <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" required autoFocus className="h-11" />
          <FieldError errors={errorsFor("email")} />
        </Field>
        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("auth.sendResetLink")}
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </div>
  );
}

export function SetPasswordForm({ mode, email }: { mode: "invite" | "reset"; email: string }) {
  const { t, tm } = useI18n();
  const [state, action, pending] = useActionState(updatePasswordAction, null);
  const errorsFor = useFieldErrors(state);
  const [password, setPassword] = useState("");
  const rules = [
    { test: (v: string) => v.length >= 10, label: t("auth.rules.length") },
    { test: (v: string) => /[a-z]/.test(v), label: t("auth.rules.lower") },
    { test: (v: string) => /[A-Z]/.test(v), label: t("auth.rules.upper") },
    { test: (v: string) => /\d/.test(v), label: t("auth.rules.number") },
  ];

  return (
    <div className="space-y-7">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "invite" ? t("auth.welcomeSetPassword") : t("auth.chooseNewPassword")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("auth.signedInAs", { email })}</p>
      </header>
      {state?.error ? <Notice tone="error">{tm(state.error)}</Notice> : null}
      <form action={action} className="space-y-5" noValidate>
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(state?.fieldErrors?.password)}>
            <FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel>
            <PasswordInput id="password" name="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-xs">
              {rules.map((rule) => {
                const met = rule.test(password);
                return (
                  <li key={rule.label} className={cn("flex items-center gap-1.5", met ? "text-success" : "text-muted-foreground")}>
                    <CheckCircle2 className={cn("size-3.5", !met && "opacity-40")} />
                    {rule.label}
                  </li>
                );
              })}
            </ul>
            <FieldError errors={errorsFor("password")} />
          </Field>
          <Field data-invalid={Boolean(state?.fieldErrors?.confirm)}>
            <FieldLabel htmlFor="confirm">{t("auth.confirmPassword")}</FieldLabel>
            <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
            <FieldError errors={errorsFor("confirm")} />
          </Field>
        </FieldGroup>
        <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          {mode === "invite" ? t("auth.activateAccount") : t("auth.updatePassword")}
        </Button>
      </form>
    </div>
  );
}
