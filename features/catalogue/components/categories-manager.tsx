"use client";

import { FolderTree, MoreHorizontal, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteCategoryAction, saveCategoryAction } from "@/features/catalogue/actions";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";

export type CategoryItem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  deviceCount: number | null;
};

type Draft = { id?: string; name: string; description: string; isActive: boolean };

export function CategoriesManager({ categories, timezone }: { categories: CategoryItem[]; timezone: string }) {
  const { t, tm, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>();
  const [deleting, setDeleting] = useState<CategoryItem | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [categories, query],
  );

  const save = (draft: Draft) =>
    startTransition(async () => {
      const result = await saveCategoryAction(draft);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(tm(result.error));
        return;
      }
      toast.success(result.message ? tm(result.message) : t("common.saved"));
      setEditing(null);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("categories.search")} className="h-10 bg-card ps-9" aria-label={t("categories.search")} />
        </div>
        <Button
          className="ms-auto"
          onClick={() => {
            setErrors(undefined);
            setEditing({ name: "", description: "", isActive: true });
          }}
        >
          <Plus /> {t("categories.newCategory")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed bg-card py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderTree />
            </EmptyMedia>
            <EmptyTitle>{categories.length ? t("categories.noneMatch") : t("categories.noneYet")}</EmptyTitle>
            <EmptyDescription>{t("categories.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <Table>
            <TableHeader className="bg-surface-raised">
              <TableRow>
                <TableHead className="ps-4">{t("categories.category")}</TableHead>
                <TableHead className="text-end">{t("categories.devices")}</TableHead>
                <TableHead>{t("categories.status")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("categories.created")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="ps-4">
                    <p className="font-medium">{c.name}</p>
                    {c.description ? <p className="max-w-md truncate text-xs text-muted-foreground">{c.description}</p> : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{c.deviceCount ?? "—"}</TableCell>
                  <TableCell>{c.isActive ? <ToneBadge tone="success">{t("common.active")}</ToneBadge> : <ToneBadge>{t("common.inactive")}</ToneBadge>}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(c.createdAt, timezone, "date", locale)}</TableCell>
                  <TableCell className="pe-3 text-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("common.actions")} ${c.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setErrors(undefined);
                            setEditing({ id: c.id, name: c.name, description: c.description ?? "", isActive: c.isActive });
                          }}
                        >
                          <Pencil /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => save({ id: c.id, name: c.name, description: c.description ?? "", isActive: !c.isActive })}>
                          <Power /> {c.isActive ? t("categories.deactivate") : t("categories.activate")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                          <Trash2 /> {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && !pending && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t("categories.editCategory") : t("categories.newCategory")}</DialogTitle>
            <DialogDescription>{t("categories.formDesc")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              id="category-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                save(editing);
              }}
            >
              <FieldGroup className="gap-4">
                <Field data-invalid={Boolean(errors?.name) || undefined}>
                  <FieldLabel htmlFor="cat-name">{t("categories.name")}</FieldLabel>
                  <Input id="cat-name" autoFocus maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <FieldError errors={errors?.name?.map((m) => ({ message: tm(m) }))} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="cat-description">{t("categories.description")}</FieldLabel>
                  <Textarea id="cat-description" rows={3} maxLength={1000} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </Field>
                <Field orientation="horizontal" className="justify-between">
                  <FieldLabel htmlFor="cat-active">{t("common.active")}</FieldLabel>
                  <Switch id="cat-active" checked={editing.isActive} onCheckedChange={(v) => setEditing({ ...editing, isActive: v })} />
                </Field>
              </FieldGroup>
            </form>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="category-form" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="destructive"
        title={t("categories.deleteTitle", { name: deleting?.name ?? "" })}
        description={
          deleting?.deviceCount
            ? t("categories.deleteUsed", { count: deleting.deviceCount })
            : t("categories.deleteUnused")
        }
        confirmLabel={t("categories.deleteConfirm")}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteCategoryAction(deleting.id);
          if (!result.ok) {
            toast.error(tm(result.error));
            return false;
          }
          toast.success(result.message ? tm(result.message) : t("categories.toastDeleted"));
        }}
      />
    </div>
  );
}
