import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { LocaleBoundary } from "@/components/providers/locale-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthHero, AuthMobileBrand, LanguageToggle } from "@/features/auth/components/auth-chrome";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <LocaleBoundary>
        <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <AuthHero />
          <main className="relative flex items-center justify-center px-4 py-10 sm:px-8">
            <div className="absolute end-4 top-4">
              <LanguageToggle />
            </div>
            <div className="w-full max-w-[400px]">
              <AuthMobileBrand />
              {children}
            </div>
          </main>
        </div>
      </LocaleBoundary>
    </Suspense>
  );
}

function AuthSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="w-full max-w-[400px] space-y-5 px-4">
        <LogoMark className="size-10" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
