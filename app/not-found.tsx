import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <LogoMark className="size-12" />
      <div className="space-y-1.5">
        <p className="font-heading text-5xl font-bold text-brand">404</p>
        <h1 className="text-xl font-semibold">Page not found · الصفحة غير موجودة</h1>
        <p className="text-sm text-muted-foreground">The page doesn’t exist, or you don’t have access to it.</p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard · العودة</Link>
      </Button>
    </main>
  );
}
