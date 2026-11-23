"use server";

import { refresh, revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { brandSchema, categorySchema, type BrandInput, type CategoryInput } from "@/lib/validation/schemas";

function revalidateCatalogue() {
  revalidatePath("/brands", "layout");
  revalidatePath("/categories");
  revalidatePath("/devices");
  revalidatePath("/dashboard");
  refresh();
}

// Brands ---------------------------------------------------------------------
// Writes go straight to the table; RLS (brands.manage) and the baseline audit
// trigger apply, so the database enforces and records every change.

export async function saveBrandAction(input: BrandInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("brands.manage");
  if ("error" in auth) return auth.error;
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const row = {
    name: v.name,
    description: v.description ?? null,
    logo_url: v.logoUrl ?? null,
    accent_color: v.accentColor,
    is_active: v.isActive,
    sort_order: v.sortOrder,
  };
  const supabase = await createClient();
  const result = v.id
    ? await supabase.from("brands").update(row).eq("id", v.id).select("id").single()
    : await supabase.from("brands").insert(row).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") return fail("brands.duplicate", { name: ["brands.duplicate"] });
    return fail(toUserMessage(result.error));
  }
  revalidateCatalogue();
  return ok({ id: result.data.id }, v.id ? "brands.updated" : "brands.created");
}

export async function setBrandActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("brands.manage");
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { error, count } = await supabase.from("brands").update({ is_active: isActive }, { count: "exact" }).eq("id", id);
  if (error) return fail(toUserMessage(error));
  if (!count) return fail("errors.notFound");
  revalidateCatalogue();
  return ok(undefined, isActive ? "brands.activated" : "brands.deactivated");
}

/**
 * Devices reference their brand with ON DELETE RESTRICT, so a brand can only be
 * deleted once it has no devices at all (archived ones included). Pass
 * `leavingPage` from the brand's own page: the caller navigates to /brands, so
 * the deleted brand's page is not refreshed into a 404 first.
 */
export async function deleteBrandAction(id: string, options: { leavingPage?: boolean } = {}): Promise<ActionResult> {
  const auth = await authorizeAction("brands.manage");
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { error, count } = await supabase.from("brands").delete({ count: "exact" }).eq("id", id);
  if (error) {
    if (error.code === "23503") return fail("brands.hasDevices");
    return fail(toUserMessage(error));
  }
  if (!count) return fail("errors.notFound");
  if (options.leavingPage) {
    revalidatePath("/brands");
    revalidatePath("/categories");
    revalidatePath("/devices");
    revalidatePath("/dashboard");
  } else {
    revalidateCatalogue();
  }
  return ok(undefined, "brands.deleted");
}

// Categories -----------------------------------------------------------------

export async function saveCategoryAction(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("categories.manage");
  if ("error" in auth) return auth.error;
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const row = { name: v.name, description: v.description ?? null, is_active: v.isActive };
  const supabase = await createClient();
  const result = v.id
    ? await supabase.from("categories").update(row).eq("id", v.id).select("id").single()
    : await supabase.from("categories").insert(row).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") return fail("categories.duplicate", { name: ["categories.duplicate"] });
    return fail(toUserMessage(result.error));
  }
  revalidateCatalogue();
  return ok({ id: result.data.id }, v.id ? "categories.toastUpdated" : "categories.toastCreated");
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  const auth = await authorizeAction("categories.manage");
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  // Devices keep existing (category_id → NULL, per the baseline foreign key);
  // deactivating is usually the better choice, so the UI offers both.
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return fail(toUserMessage(error));
  revalidateCatalogue();
  return ok(undefined, "categories.toastDeleted");
}
