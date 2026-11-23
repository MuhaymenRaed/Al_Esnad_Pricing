"use client";

import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkSyncAction } from "@/features/devices/sync-actions";
import type { MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { SyncCompare } from "../sync-state";
import { PublishDialog } from "./publish-dialog";

/** "Check" (re-read both systems, nothing changes) and "Publish…" (review, confirm, publish) on a device page. */
export function DeviceSyncActions({
  deviceId,
  money,
  compare,
  lists,
  canPublish,
}: {
  deviceId: string;
  money: MoneyFormat;
  compare: SyncCompare;
  lists: { erpSelling: string | null; erpBuying: string | null };
  canPublish: boolean;
}) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const [checking, startChecking] = useTransition();
  const [open, setOpen] = useState(false);
  const ids = useMemo(() => [deviceId], [deviceId]);

  const check = () =>
    startChecking(async () => {
      const result = await checkSyncAction([deviceId]);
      if (!result.ok) toast.error(tm(result.error));
      else toast.success(t("sync.checked"));
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={check} disabled={checking} className="flex-1">
        <RefreshCw className={cn(checking && "animate-spin")} />
        {t("sync.check")}
      </Button>
      {canPublish ? (
        <Button size="sm" onClick={() => setOpen(true)} className="flex-1">
          <Send />
          {t("sync.publish")}
        </Button>
      ) : null}
      {open ? (
        <PublishDialog
          ids={ids}
          open
          onOpenChange={setOpen}
          money={money}
          compare={compare}
          lists={lists}
          canPublish={canPublish}
          onFinished={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
