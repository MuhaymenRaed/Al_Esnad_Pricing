"use server";

import { refresh, revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { refreshStaleSyncState } from "@/lib/price-sync/state";
import { createClient } from "@/lib/supabase/server";
import {
  deviceSubmissionSchema,
  entriesToMetadata,
  managedDeviceSchema,
  type DeviceSubmissionInput,
  type ManagedDeviceInput,
} from "@/lib/validation/schemas";
import type { DeviceStatus } from "@/types/database";

function revalidateDevices(id?: string) {
  revalidatePath("/devices");
  revalidatePath("/dashboard");
  revalidatePath("/brands", "layout");
  if (id) revalidatePath(`/devices/${id}`);
}

export type SavedFinancials = {
  officialPurchasePrice: string;
  discountAmount: string;
  paybackAmount: string;
  finalCostBeforeProfit: string;
  companyProfit: string;
  finalSellingPrice: string;
};

/**
 * Administrator / Pricing Manager: create or update a device with its full
 * pricing in ONE transaction (public.save_device). The database computes the
 * discount amount, final cost and selling price; we read them back.
 * alisnad.iq and ERPNext are NOT changed here — only "Publish" does that.
 */
export async function saveDeviceAction(
  input: ManagedDeviceInput,
): Promise<ActionResult<{ id: string; financials: SavedFinancials | null; status: DeviceStatus; updatedAt: string; linked: boolean }>> {
  const isNew = !input.id;
  const auth = await authorizeAction(isNew ? ["devices.create", "financials.update"] : ["devices.update", "financials.update"]);
  if ("error" in auth) return auth.error;

  const parsed = managedDeviceSchema.safeParse(input);
  if (!parsed.success) {
    return fail("errors.fixFields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  // Approval rules (submissions.review etc.) are enforced inside the database.
  const { id, device, financials, status, expectedUpdatedAt } = parsed.data;

  const supabase = await createClient();
  const { data: savedId, error } = await supabase.rpc("save_device", {
    p_device_id: id ?? null,
    p_device: {
      name: device.name,
      brand_id: device.brandId,
      category_id: device.categoryId,
      sku: device.sku ?? null,
      model_number: device.modelNumber ?? null,
      metadata: entriesToMetadata(device.metadata),
      status,
      expected_updated_at: expectedUpdatedAt ?? null,
      link_codes: device.linkCodes,
    },
    p_financials: {
      official_purchase_price: financials.officialPurchasePrice,
      discount_type: financials.discountType,
      discount_value: financials.discountValue || "0",
      payback_amount: financials.paybackAmount || "0",
      company_profit: financials.companyProfit || "0",
    },
  });
  if (error?.code === "23505" && /device_link_codes/.test(error.message)) {
    return fail("validation.codeTaken", { linkCodes: ["validation.codeTaken"] });
  }
  if (error || !savedId) return fail(toUserMessage(error, "errors.saveFailed"));

  // New or changed link codes: look them up (read-only) so the status badges are current.
  if (device.linkCodes.length) await refreshStaleSyncState([savedId]);

  // Read back the authoritative values computed by the database.
  const { data: saved } = await supabase.rpc("get_managed_device", { p_id: savedId });
  const record = saved as unknown as {
    device: { status: DeviceStatus; updated_at: string };
    financials: Record<string, number | string> | null;
  } | null;
  const f = record?.financials;

  revalidateDevices(savedId);
  return ok(
    {
      id: savedId,
      linked: device.linkCodes.length > 0,
      status: record?.device.status ?? status,
      updatedAt: record?.device.updated_at ?? new Date().toISOString(),
      financials: f
        ? {
            officialPurchasePrice: String(f.official_purchase_price),
            discountAmount: String(f.discount_amount),
            paybackAmount: String(f.payback_amount),
            finalCostBeforeProfit: String(f.final_cost_before_profit),
            companyProfit: String(f.company_profit),
            finalSellingPrice: String(f.final_selling_price),
          }
        : null,
    },
    isNew ? "devices.toast.created" : "devices.toast.updated",
  );
}

/** Data Entry Operator: submit a new device (purchase price only). */
export async function submitDeviceAction(input: DeviceSubmissionInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("devices.submit");
  if ("error" in auth) return auth.error;

  const parsed = deviceSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return fail("errors.fixFields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_device", {
    p_name: v.name,
    p_brand_id: v.brandId,
    p_category_id: v.categoryId,
    p_official_purchase_price: v.officialPurchasePrice,
    p_sku: v.sku ?? null,
    p_model_number: v.modelNumber ?? null,
    p_metadata: entriesToMetadata(v.metadata),
  });
  if (error || !data) return fail(toUserMessage(error, "errors.submitFailed"));
  revalidateDevices();
  return ok({ id: data }, "devices.toast.submitted");
}

/** Data Entry Operator: edit an own submission awaiting review (when allowed). */
export async function updateSubmissionAction(id: string, input: DeviceSubmissionInput): Promise<ActionResult> {
  const auth = await authorizeAction("devices.edit_own_submissions");
  if ("error" in auth) return auth.error;

  const parsed = deviceSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return fail("errors.fixFields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_submission", {
    p_id: id,
    p_name: v.name,
    p_brand_id: v.brandId,
    p_category_id: v.categoryId,
    p_official_purchase_price: v.officialPurchasePrice,
    p_sku: v.sku ?? null,
    p_model_number: v.modelNumber ?? null,
    p_metadata: entriesToMetadata(v.metadata),
  });
  if (error) return fail(toUserMessage(error, "errors.submitFailed"));
  revalidateDevices(id);
  refresh();
  return ok(undefined, "devices.toast.submissionUpdated");
}

/** Bulk approve / reject / archive / restore through the guarded RPC. */
export async function setDevicesStatusAction(
  ids: string[],
  status: DeviceStatus,
): Promise<ActionResult<{ changed: number; requested: number }>> {
  const needed = status === "archived" ? "devices.archive" : "devices.update";
  const auth = await authorizeAction(status === "active" || status === "rejected" ? [needed, "submissions.review"] : needed);
  if ("error" in auth) return auth.error;
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 1000);
  if (!unique.length) return fail("errors.selectDevices");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_devices_status", { p_ids: unique, p_status: status });
  if (error) return fail(toUserMessage(error));
  revalidateDevices();
  refresh();
  return ok({ changed: data ?? 0, requested: unique.length });
}

/**
 * Permanent deletion through the guarded RPC (devices.delete). Pass
 * `leavingPage` from a device's own page: the caller navigates away, so the
 * current (now deleted) page is not refreshed into a 404 first.
 */
export async function deleteDevicesAction(
  ids: string[],
  options: { leavingPage?: boolean } = {},
): Promise<ActionResult<{ deleted: number; requested: number }>> {
  const auth = await authorizeAction("devices.delete");
  if ("error" in auth) return auth.error;
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 1000);
  if (!unique.length) return fail("errors.selectDevices");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_devices", { p_ids: unique });
  if (error) return fail(toUserMessage(error));
  revalidateDevices();
  if (!options.leavingPage) refresh();
  return ok({ deleted: data ?? 0, requested: unique.length });
}
