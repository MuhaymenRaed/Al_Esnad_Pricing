import type { DataProjection } from "@/lib/permissions";
import type { DeviceStatus, DiscountType } from "@/types/database";
import type { DeviceSync } from "./sync-state";

/** Normalised row used by every device table, whatever the projection. */
export type DeviceListRow = {
  id: string;
  name: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present for the full and submissions projections. */
  status?: DeviceStatus;
  sku?: string | null;
  modelNumber?: string | null;
  /** Full projection only (private financials). */
  purchasePrice?: string | null;
  discountType?: DiscountType | null;
  discountValue?: string | null;
  discountAmount?: string | null;
  paybackAmount?: string | null;
  finalCost?: string | null;
  profit?: string | null;
  /** Full + catalog projections. */
  sellingPrice?: string | null;
  sortValue?: string;
  /** Full projection: publishing status on ERPNext and alisnad.iq (absent when neither is connected). */
  sync?: DeviceSync;
};

/** What a bulk selection keeps of each device (rows can come from several pages or "select all"). */
export type SelectedDevice = Pick<DeviceListRow, "id" | "name" | "brandId" | "status">;

export type DevicePage = {
  rows: DeviceListRow[];
  nextCursor: string | null;
  total: number | null;
};

export type FacetOption = { id: string; label: string; count: number; color?: string };

export type DeviceSummary = {
  stats: {
    count: number;
    min_price?: number | null;
    max_price?: number | null;
    avg_price?: number | null;
    brand_count?: number;
    priced_count?: number;
    pending_count?: number;
    active_count?: number;
    total_purchase?: number;
    total_discount?: number;
    total_payback?: number;
    total_cost?: number;
    total_profit?: number;
    total_selling?: number;
    avg_margin_pct?: number | null;
  };
  brands: FacetOption[];
  categories: FacetOption[];
  statuses: Array<{ value: DeviceStatus; count: number }>;
};

export type DevicePageResponse = DevicePage & { summary?: DeviceSummary; projection: DataProjection };

export type Option = { id: string; name: string; color?: string; isActive?: boolean };
