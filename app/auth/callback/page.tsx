import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Spinner } from "@/components/ui/spinner";
import { HashSessionHandler } from "./hash-session-handler";

export const metadata: Metadata = { title: "Signing in" };

/** Client-side completion of e-mail links that carry the session in the URL fragment. */
export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark className="size-12" />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Verifying your link… · جارٍ التحقق
      </p>
      <Suspense>
        <HashSessionHandler />
      </Suspense>
    </main>
  );
}
