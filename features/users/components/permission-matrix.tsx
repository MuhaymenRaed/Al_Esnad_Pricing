"use client";

import { Lock } from "lucide-react";
import { Fragment, useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setRolePermissionAction } from "@/features/users/permission-actions";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/core";
import { ROLES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { AppRole, PermissionMatrixRow } from "@/types/database";

export function PermissionMatrix({ rows, readOnly }: { rows: PermissionMatrixRow[]; readOnly: boolean }) {
  const { t, tm } = useI18n();
  const [optimistic, setOptimistic] = useOptimistic(rows, (state, change: { role: AppRole; key: string; allowed: boolean }) =>
    state.map((r) => (r.role === change.role && r.permission_key === change.key ? { ...r, allowed: change.allowed } : r)),
  );
  const [, startTransition] = useTransition();

  const keys = [...new Map(optimistic.map((r) => [r.permission_key, r])).values()];
  const groups = [...new Set(keys.map((k) => k.permission_group))];
  const cell = (role: AppRole, key: string) => optimistic.find((r) => r.role === role && r.permission_key === key);
  const label = (key: string, fallback: string) => {
    const translated = t(`permissions.labels.${key}` as MessageKey);
    return translated.startsWith("permissions.labels.") ? fallback : translated;
  };
  const group = (g: string) => {
    const translated = t(`permissions.groups.${g}` as MessageKey);
    return translated.startsWith("permissions.groups.") ? g : translated;
  };

  const toggle = (role: AppRole, key: string, allowed: boolean) =>
    startTransition(async () => {
      setOptimistic({ role, key, allowed });
      const result = await setRolePermissionAction(role, key, allowed);
      if (result.ok) toast.success(tm(result.message));
      else toast.error(tm(result.error));
    });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-surface-raised">
          <tr>
            <th className="w-[40%] border-b px-4 py-3 text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("permissions.permission")}</th>
            {ROLES.map((r) => (
              <th key={r} className="border-b px-3 py-3 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t(`roles.${r}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr>
                <td colSpan={ROLES.length + 1} className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-foreground/80">
                  {group(g)}
                </td>
              </tr>
              {keys
                .filter((k) => k.permission_group === g)
                .map((k) => (
                  <tr key={k.permission_key} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{label(k.permission_key, k.description)}</p>
                      <p className="font-mono text-[0.7rem] text-muted-foreground" dir="ltr">
                        {k.permission_key}
                      </p>
                    </td>
                    {ROLES.map((role) => {
                      const c = cell(role, k.permission_key);
                      if (!c) return <td key={role} />;
                      return (
                        <td key={role} className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch
                              checked={c.allowed}
                              disabled={c.locked || readOnly}
                              aria-label={`${t(`roles.${role}`)}: ${k.permission_key}`}
                              onCheckedChange={(v) => toggle(role, k.permission_key, v)}
                              className={cn(c.allowed && "data-[state=checked]:bg-success")}
                            />
                            {c.locked ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Lock className="size-3.5 text-muted-foreground" aria-label={t("permissions.locked")} />
                                </TooltipTrigger>
                                <TooltipContent>{role === "administrator" ? t("permissions.lockedAdmin") : t("permissions.lockedSeparation")}</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
