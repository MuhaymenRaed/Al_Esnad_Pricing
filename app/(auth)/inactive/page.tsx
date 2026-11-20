import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Account inactive" };

export default async function InactivePage() {
  const { t } = await getT();
  return (
    <div className="space-y-6">
      <div className="flex size-12 items-center justify-center rounded-xl bg-warning-soft text-warning">
        <ShieldOff className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.inactiveTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.inactiveBody")}</p>
      </div>
      <form action={signOutAction.bind(null, "inactive")}>
        <Button type="submit" variant="outline" className="w-full" size="lg">
          {t("nav.signOut")}
        </Button>
      </form>
    </div>
  );
}
