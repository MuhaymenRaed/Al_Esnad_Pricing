"use client";

import { Eye, LoaderCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setPreviewRoleAction } from "@/features/session/actions";
import { useI18n } from "@/lib/i18n/client";
import type { PreviewRole } from "@/lib/permissions";

export function ViewAsSwitcher({ previewRole }: { previewRole: PreviewRole | null }) {
  const { t, tm } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 px-0.5 text-[0.7rem] font-medium text-muted-foreground" title={t("preview.hint")}>
        {pending ? <LoaderCircle className="size-3 animate-spin" /> : <Eye className="size-3" />}
        {t("preview.viewAs")}
      </label>
      <Select
        value={previewRole ?? "full"}
        onValueChange={(value) =>
          startTransition(async () => {
            const result = await setPreviewRoleAction(value === "full" ? null : value);
            if (!result.ok) toast.error(tm(result.error));
          })
        }
      >
        <SelectTrigger size="sm" className="h-8 w-full bg-background text-xs" aria-label={t("preview.viewAs")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="full">{t("preview.full")}</SelectItem>
          <SelectItem value="viewer">{t("preview.viewer")}</SelectItem>
          <SelectItem value="data_entry">{t("preview.data_entry")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
