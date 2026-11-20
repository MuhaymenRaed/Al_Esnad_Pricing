import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { AppFrame } from "@/components/layout/app-frame";
import { SessionWatcher } from "@/components/layout/session-watcher";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession, toClientSession } from "@/lib/auth/session";
import { I18nProvider } from "@/lib/i18n/client";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <I18nProvider locale={session.locale}>
      <AppFrame session={toClientSession(session)}>{children}</AppFrame>
      <SessionWatcher idleTimeoutMinutes={session.settings.idleTimeoutMinutes} themePreference={session.themePreference} />
    </I18nProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:ps-64">
      <aside className="fixed inset-y-0 start-0 hidden w-64 flex-col gap-3 border-e bg-sidebar p-5 lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="mt-2 h-10 w-full" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </aside>
      <div className="mx-auto max-w-[1400px] space-y-4 px-4 pt-8 sm:px-6 lg:px-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
