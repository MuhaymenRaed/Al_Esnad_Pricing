"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Confirmation before consequential actions. The dialog stays open (with a
 * spinner) until the async action settles, and closes only on success.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmDisabled,
  tone = "default",
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  /** Explains-only mode: the description says why the action is not possible. */
  confirmDisabled?: boolean;
  tone?: "default" | "destructive";
  onConfirm: () => Promise<boolean | void> | boolean | void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();
  const t = useT();

  return (
    <AlertDialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || confirmDisabled}
            className={cn(tone === "destructive" && buttonVariants({ variant: "destructive" }))}
            onClick={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await onConfirm();
                if (result !== false) setOpen(false);
              });
            }}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
