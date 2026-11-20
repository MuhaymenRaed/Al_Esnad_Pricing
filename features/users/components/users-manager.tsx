"use client";

import {
  Check,
  Copy,
  History,
  KeyRound,
  MailPlus,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ToneBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createUserAction,
  inviteUserAction,
  resendInvitationAction,
  revokeInvitationAction,
  setUserActiveAction,
  setUserPasswordAction,
  setUserRoleAction,
  updateUserNameAction,
} from "@/features/users/actions";
import { formatDate, formatRelative, initials } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { ROLES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types/database";

export type UserRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
  confirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string;
};

type Status = "active" | "pending" | "deactivated";
const statusOf = (u: UserRow): Status => (!u.isActive ? "deactivated" : !u.lastSignInAt ? "pending" : "active");

type Errors = Record<string, string[] | undefined> | undefined;

function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = sets.join("");
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  const chars = sets.map((s, i) => s[bytes[i] % s.length]);
  for (let i = sets.length; i < 14; i++) chars.push(all[bytes[i] % all.length]);
  return chars.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1)).join("");
}

export function UsersManager({ users, currentUserId, timezone }: { users: UserRow[]; currentUserId: string; timezone: string }) {
  const { t, tm, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<AppRole | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [addOpen, setAddOpen] = useState(params.get("add") === "1" || params.get("invite") === "1");
  const [confirm, setConfirm] = useState<{ kind: "deactivate" | "revoke" | "role"; user: UserRow; role?: AppRole } | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserRow | null>(null);
  const [nameFor, setNameFor] = useState<UserRow | null>(null);
  const [, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!q || u.email.toLowerCase().includes(q) || (u.fullName ?? "").toLowerCase().includes(q)) &&
        (role === "all" || u.role === role) &&
        (status === "all" || statusOf(u) === status),
    );
  }, [users, query, role, status]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(tm(result.message ?? "common.done"));
      else toast.error(tm(result.error));
    });

  const counts = {
    all: users.length,
    active: users.filter((u) => statusOf(u) === "active").length,
    pending: users.filter((u) => statusOf(u) === "pending").length,
    deactivated: users.filter((u) => statusOf(u) === "deactivated").length,
  };
  const tabs: Array<[Status | "all", string, number]> = [
    ["all", t("users.all"), counts.all],
    ["active", t("users.activeCount"), counts.active],
    ["pending", t("users.pendingCount"), counts.pending],
    ["deactivated", t("users.deactivated"), counts.deactivated],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            aria-pressed={status === key}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-start shadow-card transition-colors hover:border-foreground/20",
              status === key && "border-brand/40 ring-2 ring-brand/10",
            )}
          >
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className="mt-0.5 block font-heading text-xl font-semibold tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("users.search")} className="h-11 bg-card ps-9" />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as AppRole | "all")}>
          <SelectTrigger className="h-11 w-52 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.allRoles")}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`roles.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="ms-auto h-11" size="lg" onClick={() => setAddOpen(true)}>
          <UserPlus /> {t("users.addUser")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed bg-card py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>{t("users.noneMatch")}</EmptyTitle>
            <EmptyDescription>{t("users.noneHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
          <Table>
            <TableHeader className="bg-surface-raised">
              <TableRow>
                <TableHead className="ps-4">{t("users.columns.user")}</TableHead>
                <TableHead>{t("users.columns.role")}</TableHead>
                <TableHead>{t("users.columns.status")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("users.columns.joined")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("users.columns.lastSignIn")}</TableHead>
                <TableHead className="w-12 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => {
                const st = statusOf(u);
                const self = u.id === currentUserId;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="ps-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-charcoal text-[0.7rem] font-semibold text-background">{initials(u.fullName ?? u.email)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {u.fullName ?? "—"}
                            {self ? <span className="ms-1.5 text-xs font-normal text-muted-foreground">({t("common.you")})</span> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {u.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={u.role === "administrator" ? "brand" : u.role === "pricing_manager" ? "gold" : u.role === "viewer" ? "info" : "neutral"}>
                        {t(`roles.${u.role}`)}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      {st === "active" ? (
                        <ToneBadge tone="success">{t("users.statusActive")}</ToneBadge>
                      ) : st === "pending" ? (
                        <ToneBadge tone="warning">{t("users.statusPending")}</ToneBadge>
                      ) : (
                        <ToneBadge>{t("users.statusDeactivated")}</ToneBadge>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{formatDate(u.createdAt, timezone, "date", locale)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell" suppressHydrationWarning>
                      {u.lastSignInAt ? formatRelative(u.lastSignInAt, locale) : t("common.never")}
                    </TableCell>
                    <TableCell className="pe-3 text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={t("common.actions")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{u.email}</DropdownMenuLabel>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger disabled={self}>
                              <ShieldCheck /> {t("users.changeRole")}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuRadioGroup value={u.role} onValueChange={(v) => v !== u.role && setConfirm({ kind: "role", user: u, role: v as AppRole })}>
                                {ROLES.map((r) => (
                                  <DropdownMenuRadioItem key={r} value={r}>
                                    {t(`roles.${r}`)}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuItem onSelect={() => setNameFor(u)}>
                            <Pencil /> {t("users.editName")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setPasswordFor(u)}>
                            <KeyRound /> {t("users.setPassword")}
                          </DropdownMenuItem>
                          {st === "pending" && !u.confirmed ? (
                            <DropdownMenuItem onSelect={() => run(() => resendInvitationAction(u.id))}>
                              <RefreshCw /> {t("users.resendInvite")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          {u.isActive ? (
                            <DropdownMenuItem variant="destructive" disabled={self} onSelect={() => setConfirm({ kind: "deactivate", user: u })}>
                              <PowerOff /> {t("users.deactivate")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => run(() => setUserActiveAction(u.id, true))}>
                              <Power /> {t("users.activate")}
                            </DropdownMenuItem>
                          )}
                          {!u.lastSignInAt && !self ? (
                            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "revoke", user: u })}>
                              <Trash2 /> {t("users.revokeInvite")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={`/audit-logs?actor=${u.id}`}>
                              <History /> {t("users.activityBy")}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/audit-logs?record=${u.id}`}>
                              <History /> {t("users.changesTo")}
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddUserDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o && (params.get("add") || params.get("invite"))) router.replace("/users", { scroll: false });
        }}
      />
      {passwordFor ? <PasswordDialog user={passwordFor} onClose={() => setPasswordFor(null)} /> : null}
      {nameFor ? <NameDialog user={nameFor} onClose={() => setNameFor(null)} /> : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone={confirm?.kind === "role" ? "default" : "destructive"}
        title={
          confirm?.kind === "deactivate"
            ? t("users.confirmDeactivate", { email: confirm.user.email })
            : confirm?.kind === "revoke"
              ? t("users.confirmRevoke")
              : t("users.confirmRole", { role: confirm?.role ? t(`roles.${confirm.role}`) : "" })
        }
        description={
          confirm?.kind === "deactivate"
            ? t("users.confirmDeactivateBody")
            : confirm?.kind === "revoke"
              ? t("users.confirmRevokeBody")
              : confirm?.role
                ? t("users.confirmRoleBody", { description: t(`roleDescriptions.${confirm.role}`) })
                : ""
        }
        confirmLabel={confirm?.kind === "deactivate" ? t("users.deactivate") : confirm?.kind === "revoke" ? t("common.delete") : t("users.changeRole")}
        onConfirm={async () => {
          if (!confirm) return;
          const result =
            confirm.kind === "deactivate"
              ? await setUserActiveAction(confirm.user.id, false)
              : confirm.kind === "revoke"
                ? await revokeInvitationAction(confirm.user.id)
                : await setUserRoleAction(confirm.user.id, confirm.role!);
          if (!result.ok) {
            toast.error(tm(result.error));
            return false;
          }
          toast.success(tm(result.message ?? "common.done"));
        }}
      />
    </div>
  );
}

function useErrors(errors: Errors) {
  const { tm } = useI18n();
  return (k: string) => errors?.[k]?.map((message) => ({ message: tm(message) }));
}

function PasswordField({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" className="font-mono" autoComplete="new-password" aria-invalid={invalid || undefined} />
      <Button type="button" variant="outline" onClick={() => onChange(generatePassword())} title={t("users.add.generate")}>
        <Wand2 />
        <span className="hidden sm:inline">{t("users.add.generate")}</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!value}
        aria-label={t("users.add.copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, tm } = useI18n();
  const [mode, setMode] = useState<"create" | "invite">("create");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<AppRole>("viewer");
  const [errors, setErrors] = useState<Errors>();
  const err = useErrors(errors);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setEmail("");
    setFullName("");
    setPassword(generatePassword());
    setRole("viewer");
    setErrors(undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-brand" /> {t("users.add.title")}
          </DialogTitle>
          <DialogDescription>{t("users.add.desc")}</DialogDescription>
        </DialogHeader>
        <form
          id="add-user-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = mode === "create" ? await createUserAction({ email, fullName, role, password }) : await inviteUserAction({ email, fullName, role });
              if (!result.ok) {
                setErrors(result.fieldErrors);
                toast.error(tm(result.error));
                return;
              }
              toast.success(t(mode === "create" ? "users.add.created" : "users.add.invited", { email }), {
                description: mode === "create" ? `${email} · ${password}` : undefined,
                duration: mode === "create" ? 15000 : 5000,
              });
              onOpenChange(false);
              reset();
            });
          }}
        >
          <FieldGroup className="gap-4">
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "create" | "invite")} className="w-full">
              <ToggleGroupItem value="create" className="flex-1 gap-1.5 text-xs">
                <KeyRound className="size-3.5" /> {t("users.add.modeCreate")}
              </ToggleGroupItem>
              <ToggleGroupItem value="invite" className="flex-1 gap-1.5 text-xs">
                <MailPlus className="size-3.5" /> {t("users.add.modeInvite")}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="-mt-2 text-xs text-muted-foreground">{mode === "create" ? t("users.add.modeCreateHint") : t("users.add.modeInviteHint")}</p>
            <Field data-invalid={Boolean(errors?.email) || undefined}>
              <FieldLabel htmlFor="add-email">{t("users.add.email")}</FieldLabel>
              <Input id="add-email" type="email" dir="ltr" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@alesnad.iq" />
              <FieldError errors={err("email")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="add-name">
                {t("users.add.fullName")} <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
              </FieldLabel>
              <Input id="add-name" value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            {mode === "create" ? (
              <Field data-invalid={Boolean(errors?.password) || undefined}>
                <FieldLabel>{t("users.add.password")}</FieldLabel>
                <PasswordField value={password} onChange={setPassword} invalid={Boolean(errors?.password)} />
                <FieldDescription>{t("users.add.passwordHint")}</FieldDescription>
                <FieldError errors={err("password")} />
              </Field>
            ) : null}
            <Field>
              <FieldLabel>{t("users.add.role")}</FieldLabel>
              <RadioGroup value={role} onValueChange={(v) => setRole(v as AppRole)} className="gap-2">
                {ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-brand/40 has-[[data-state=checked]]:bg-brand-soft/50">
                    <RadioGroupItem value={r} className="mt-0.5" />
                    <span>
                      <span className="text-sm font-medium">{t(`roles.${r}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`roleDescriptions.${r}`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {role === "administrator" ? <FieldDescription className="text-warning">{t("users.add.adminWarning")}</FieldDescription> : null}
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="add-user-form" disabled={pending}>
            {pending ? <Spinner /> : mode === "create" ? <UserPlus /> : <MailPlus />}
            {mode === "create" ? t("users.add.submitCreate") : t("users.add.submitInvite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t, tm } = useI18n();
  const [password, setPassword] = useState(() => generatePassword());
  const [errors, setErrors] = useState<Errors>();
  const err = useErrors(errors);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.passwordDialog.title", { email: user.email })}</DialogTitle>
          <DialogDescription>{t("users.passwordDialog.desc")}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(errors?.password) || undefined}>
          <PasswordField value={password} onChange={setPassword} invalid={Boolean(errors?.password)} />
          <FieldDescription>{t("users.add.passwordHint")}</FieldDescription>
          <FieldError errors={err("password")} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setUserPasswordAction(user.id, password);
                if (!result.ok) {
                  setErrors(result.fieldErrors);
                  toast.error(tm(result.error));
                  return;
                }
                toast.success(tm(result.message), { description: `${user.email} · ${password}`, duration: 15000 });
                onClose();
              })
            }
          >
            {pending ? <Spinner /> : <KeyRound />}
            {t("users.passwordDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t, tm } = useI18n();
  const [name, setName] = useState(user.fullName ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.nameDialog.title")}</DialogTitle>
          <DialogDescription dir="ltr">{user.email}</DialogDescription>
        </DialogHeader>
        <form
          id="name-form"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await updateUserNameAction(user.id, name);
              if (!result.ok) {
                toast.error(tm(result.error));
                return;
              }
              toast.success(tm(result.message));
              onClose();
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor="user-name">{t("users.nameDialog.label")}</FieldLabel>
            <Input id="user-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="name-form" disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
