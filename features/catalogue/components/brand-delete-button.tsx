"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteBrandAction } from "@/features/catalogue/actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Delete brand" on the brand page. `deviceCount` counts every device of the
 * brand (archived included); when it is above zero the dialog only explains
 * why the brand cannot be deleted yet. Null means the count is unknown, in
 * which case the database still refuses and the toast explains.
 */
export function BrandDeleteButton({ id, name, deviceCount }: { id: string; name: string; deviceCount: number | null }) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const blocked = Boolean(deviceCount);

  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive">
          <Trash2 /> {t("brands.deleteBrand")}
        </Button>
      }
      tone="destructive"
      title={t("brands.deleteTitle", { name })}
      description={blocked ? t("brands.deleteBlocked", { count: deviceCount ?? 0 }) : t("brands.deleteBody")}
      confirmLabel={t("brands.deleteBrand")}
      confirmDisabled={blocked}
      onConfirm={async () => {
        const result = await deleteBrandAction(id, { leavingPage: true });
        if (!result.ok) {
          toast.error(tm(result.error));
          return false;
        }
        toast.success(result.message ? tm(result.message) : t("brands.deleted"));
        router.replace("/brands");
      }}
    />
  );
}
