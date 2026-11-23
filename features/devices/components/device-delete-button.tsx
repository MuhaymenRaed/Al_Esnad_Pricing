"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteDevicesAction } from "@/features/devices/actions";
import { useI18n } from "@/lib/i18n/client";

/** "Delete device" on a device's own page; returns to the device list afterwards. */
export function DeviceDeleteButton({ id, name }: { id: string; name: string }) {
  const { t, tm } = useI18n();
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" size="sm">
          <Trash2 /> {t("devices.deleteDevice")}
        </Button>
      }
      tone="destructive"
      title={t("devices.confirm.deleteOneTitle", { name })}
      description={t("devices.confirm.deleteBody")}
      confirmLabel={t("devices.deleteDevice")}
      onConfirm={async () => {
        const result = await deleteDevicesAction([id], { leavingPage: true });
        if (!result.ok) {
          toast.error(tm(result.error));
          return false;
        }
        toast.success(t("devices.toast.deleted", { count: result.data.deleted }));
        router.replace("/devices");
      }}
    />
  );
}
