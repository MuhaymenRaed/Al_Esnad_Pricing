"use client";

import {
  ClipboardList,
  FileText,
  FolderTree,
  Home,
  Languages,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  Tags,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMounted } from "@/hooks/use-mounted";
import { signOutAction } from "@/features/auth/actions";
import { savePreferencesAction } from "@/features/session/actions";
import type { ClientSession } from "@/lib/auth/session";
import { initials } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/core";
import { buildNavigation, isActivePath, type NavItem } from "@/lib/navigation";
import { caps, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { PreviewBanner } from "./preview-banner";
import { ViewAsSwitcher } from "./view-as-switcher";

const ICONS: Record<NavItem["icon"], React.ComponentType<{ className?: string }>> = {
  home: Home,
  devices: Smartphone,
  brands: Tags,
  categories: FolderTree,
  reports: FileText,
  users: Users,
  roles: ShieldCheck,
  audit: ScrollText,
  settings: Settings,
};

/** Application chrome: sidebar navigation (drawer on small screens) + content. */
export function AppFrame({ session, children }: { session: ClientSession; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { dir, t } = useI18n();

  // Close the mobile drawer after navigating (state adjusted during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <div className="min-h-dvh lg:ps-64">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t("common.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-64 border-e bg-sidebar lg:flex lg:flex-col">
        <SidebarContent session={session} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("nav.openMenu")}>
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">{t("nav.main")}</SheetTitle>
            <SidebarContent session={session} />
          </SheetContent>
        </Sheet>
        <Link href="/dashboard" className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="font-heading text-sm font-semibold">{session.settings.companyName}</span>
        </Link>
      </header>

      {session.previewRole ? <PreviewBanner role={session.previewRole} /> : null}

      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-16 sm:px-6 lg:px-10 lg:pt-8">
        {children}
      </main>
    </div>
  );
}

function SidebarContent({ session }: { session: ClientSession }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const effective = new Set<Permission>(session.effectivePermissions);
  const nav = buildNavigation(effective, session.projection);
  const main = nav.filter((i) => i.group === "main");
  const admin = nav.filter((i) => i.group === "admin");

  return (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" className="flex items-center gap-3 px-5 pt-5 pb-4">
        <LogoMark className="size-9" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-heading text-sm font-semibold">{session.settings.companyName}</span>
          <span className="block truncate text-[0.7rem] text-muted-foreground">{t("common.appName")}</span>
        </span>
      </Link>

      <div className="px-4 pb-3">
        <QuickAction session={session} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label={t("nav.main")}>
        <NavGroup items={main} pathname={pathname} />
        {admin.length ? (
          <div>
            <p className="px-3 pb-1.5 text-[0.68rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {t("nav.administration")}
            </p>
            <NavGroup items={admin} pathname={pathname} />
          </div>
        ) : null}
      </nav>

      <div className="space-y-3 border-t p-4">
        {session.permissions.includes("roles.preview") ? <ViewAsSwitcher previewRole={session.previewRole} /> : null}
        <Preferences />
        <UserCard session={session} />
      </div>
    </div>
  );
}

function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActivePath(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand",
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              {t(item.label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function QuickAction({ session }: { session: ClientSession }) {
  const { t } = useI18n();
  const perms = new Set<string>(session.effectivePermissions);
  const className = "h-10 w-full justify-start gap-2";
  if (caps.createDevice(perms))
    return (
      <Button asChild className={className}>
        <Link href="/devices/new">
          <Plus /> {t("nav.newDevice")}
        </Link>
      </Button>
    );
  if (caps.submit(perms))
    return (
      <Button asChild className={className}>
        <Link href="/devices/new">
          <ClipboardList /> {t("nav.submitDevice")}
        </Link>
      </Button>
    );
  if (perms.has("users.manage"))
    return (
      <Button asChild variant="outline" className={className}>
        <Link href="/users?add=1">
          <UserPlus /> {t("nav.addUser")}
        </Link>
      </Button>
    );
  return null;
}

/** Theme (light / dark / system) and language, saved to the profile. */
function Preferences() {
  const { theme, setTheme } = useTheme();
  const { t, tm, locale } = useI18n();
  const [pending, startTransition] = useTransition();
  const mounted = useMounted();

  const themes = [
    { value: "light", icon: Sun, label: t("theme.light") },
    { value: "dark", icon: Moon, label: t("theme.dark") },
    { value: "system", icon: Monitor, label: t("theme.system") },
  ] as const;

  const changeTheme = (value: "light" | "dark" | "system") => {
    setTheme(value);
    startTransition(async () => void (await savePreferencesAction({ theme: value })));
  };
  const changeLocale = (value: Locale) =>
    startTransition(async () => {
      const result = await savePreferencesAction({ locale: value });
      if (!result.ok) toast.error(tm(result.error));
    });

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 rounded-lg border bg-background p-0.5" role="radiogroup" aria-label={t("nav.theme")}>
        {themes.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mounted && theme === value}
            title={label}
            onClick={() => changeTheme(value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
              mounted && theme === value && "bg-accent text-foreground shadow-sm",
            )}
          >
            <Icon className="size-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 px-2.5"
        disabled={pending}
        onClick={() => changeLocale(locale === "ar" ? "en" : "ar")}
        aria-label={t("common.language")}
      >
        <Languages className="size-3.5" />
        {locale === "ar" ? "EN" : "ع"}
      </Button>
    </div>
  );
}

function UserCard({ session }: { session: ClientSession }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-3 rounded-xl bg-background p-2.5 ring-1 ring-border">
      <Avatar className="size-9">
        <AvatarFallback className="bg-charcoal text-xs font-semibold text-background">
          {initials(session.fullName ?? session.email)}
        </AvatarFallback>
      </Avatar>
      <Link href="/settings" className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{session.fullName ?? session.email}</span>
        <span className="block truncate text-[0.7rem] text-muted-foreground">{t(`roles.${session.role}`)}</span>
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("nav.signOut")}
        title={t("nav.signOut")}
        disabled={pending}
        onClick={() => startTransition(() => signOutAction())}
      >
        <LogOut className="rtl:rotate-180" />
      </Button>
    </div>
  );
}
