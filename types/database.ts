/**
 * Typed contract for the Supabase schema:
 *   supabase/migrations/20261116130000_alesnad_backend.sql   (baseline)
 *   supabase/migrations/20261117090000_app_extensions.sql    (app additions)
 *
 * Shaped like `supabase gen types typescript` output so it can be replaced by
 * the generated file at any time:
 *   npx supabase gen types typescript --project-id bfbkehxaghvuimmzjiho --schema public > types/database.ts
 *
 * NUMERIC columns arrive as JSON numbers; the app converts them to strings
 * immediately and does all money arithmetic with Decimal (see lib/pricing).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "administrator" | "pricing_manager" | "viewer" | "data_entry";
export type DeviceStatus = "draft" | "pending_review" | "active" | "rejected" | "archived";
export type DiscountType = "percentage" | "fixed";
type Numeric = number | string;

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>, Rel extends Relationship[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Rel;
};

export type CompanySettingsRow = {
  id: boolean;
  company_name: string;
  company_logo_url: string | null;
  currency_code: string;
  currency_decimal_places: number;
  timezone_name: string;
  updated_at: string;
  company_tagline: string | null;
  report_footer: string | null;
  idle_timeout_minutes: number;
  default_locale: "en" | "ar";
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  theme_preference: "light" | "dark" | "system";
  locale: "en" | "ar";
};

export type BrandRow = {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  accent_color: string | null;
  sort_order: number;
};

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DeviceRow = {
  id: string;
  name: string;
  brand_id: string;
  category_id: string | null;
  sku: string | null;
  model_number: string | null;
  metadata: Json;
  status: DeviceStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PriceSyncStatus = "pending" | "processing" | "done" | "failed" | "superseded";

export type PriceSyncJobRow = {
  id: number;
  device_id: string;
  /** Link codes the price was sent to (alisnad.iq product codes and/or ERPNext item codes). */
  codes: string[];
  selling_price: Numeric;
  /** Purchase price sent to the ERPNext buying price list (null on jobs from before it was sent). */
  buying_price: Numeric | null;
  currency_code: string;
  reason: "price_changed" | "activated" | "linked" | "manual";
  status: PriceSyncStatus;
  attempts: number;
  results: Json;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** What alisnad.iq / ERPNext held for a device's link codes at the last check or publish. */
export type DeviceSyncStateRow = {
  device_id: string;
  target: "alisnad" | "erpnext";
  codes: string[];
  /** [{ code, name, active, selling, buying? }] */
  items: Json;
  error: string | null;
  checked_at: string;
  published_at: string | null;
};
export type DeviceSyncStateUpsert = Pick<DeviceSyncStateRow, "device_id" | "target"> &
  Partial<Omit<DeviceSyncStateRow, "device_id" | "target">>;

export type DeviceFinancialsRow = {
  device_id: string;
  official_purchase_price: Numeric;
  discount_type: DiscountType;
  discount_value: Numeric;
  discount_amount: Numeric;
  payback_amount: Numeric;
  final_cost_before_profit: Numeric;
  company_profit: Numeric;
  final_selling_price: Numeric;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PermissionCatalogRow = { permission_key: string; description: string; permission_group: string };
export type RolePermissionRow = { role: AppRole; permission_key: string; allowed: boolean; updated_at: string };

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  created_at: string;
};

export type FullDeviceSearchRow = {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  brand_color: string | null;
  category_id: string | null;
  category_name: string | null;
  sku: string | null;
  model_number: string | null;
  metadata: Json;
  status: DeviceStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  official_purchase_price: Numeric | null;
  discount_type: DiscountType | null;
  discount_value: Numeric | null;
  discount_amount: Numeric | null;
  payback_amount: Numeric | null;
  final_cost_before_profit: Numeric | null;
  company_profit: Numeric | null;
  final_selling_price: Numeric | null;
  sort_value: string;
  total_count: number | null;
};

export type CatalogSearchRow = {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  brand_color: string | null;
  category_id: string | null;
  category_name: string | null;
  final_selling_price: Numeric;
  created_at: string;
  updated_at: string;
  sort_value: string;
  total_count: number | null;
};

export type SubmissionRow = {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  brand_color: string | null;
  category_id: string | null;
  category_name: string | null;
  sku: string | null;
  model_number: string | null;
  metadata: Json;
  status: DeviceStatus;
  created_at: string;
  updated_at: string;
  total_count: number;
};

export type BrandOverviewRow = {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  accent_color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  catalog_count: number;
  total_count: number | null;
  pending_count: number | null;
};

export type CatalogDeviceRow = Omit<CatalogSearchRow, "sort_value" | "total_count">;

export type PermissionMatrixRow = {
  role: AppRole;
  permission_key: string;
  description: string;
  permission_group: string;
  allowed: boolean;
  locked: boolean;
};

type SearchArgs = { p_filters?: Json; p_sort?: string; p_cursor?: Json | null; p_limit?: number };

export type Database = {
  public: {
    Tables: {
      company_settings: Table<CompanySettingsRow>;
      profiles: Table<ProfileRow>;
      permission_catalog: Table<PermissionCatalogRow>;
      role_permissions: Table<RolePermissionRow>;
      brands: Table<BrandRow, Pick<BrandRow, "name"> & Partial<Omit<BrandRow, "id" | "created_at" | "updated_at">>>;
      categories: Table<CategoryRow, Pick<CategoryRow, "name"> & Partial<Pick<CategoryRow, "description" | "is_active">>>;
      devices: Table<DeviceRow>;
      device_financials: Table<DeviceFinancialsRow>;
      device_public_pricing: Table<{ device_id: string; final_selling_price: Numeric; currency_code: string; updated_at: string }>;
      price_sync_jobs: Table<PriceSyncJobRow, never, Partial<Pick<PriceSyncJobRow, "status" | "attempts" | "results" | "last_error">>>;
      device_link_codes: Table<
        { code: string; device_id: string; created_at: string },
        never,
        never,
        [
          {
            foreignKeyName: "device_link_codes_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ]
      >;
      device_sync_state: Table<DeviceSyncStateRow, DeviceSyncStateUpsert, never>;
      audit_logs: Table<
        AuditLogRow,
        never,
        never,
        [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
    };
    Views: {
      viewer_device_catalog: { Row: CatalogDeviceRow & { currency_code: string }; Relationships: [] };
      my_device_submissions: { Row: Omit<SubmissionRow, "metadata" | "total_count" | "brand_color">; Relationships: [] };
    };
    Functions: {
      search_devices: { Args: SearchArgs; Returns: FullDeviceSearchRow[] };
      device_summary: { Args: { p_filters?: Json }; Returns: Json };
      search_catalog: { Args: SearchArgs; Returns: CatalogSearchRow[] };
      catalog_summary: { Args: { p_filters?: Json }; Returns: Json };
      get_catalog_device: { Args: { p_id: string }; Returns: CatalogDeviceRow[] };
      get_managed_device: { Args: { p_id: string }; Returns: Json };
      submit_device: {
        Args: {
          p_name: string;
          p_brand_id: string;
          p_category_id: string | null;
          p_official_purchase_price: string;
          p_sku?: string | null;
          p_model_number?: string | null;
          p_metadata?: Json;
        };
        Returns: string;
      };
      my_submissions: {
        Args: { p_search?: string | null; p_status?: DeviceStatus | null; p_limit?: number; p_offset?: number };
        Returns: SubmissionRow[];
      };
      update_my_submission: {
        Args: {
          p_id: string;
          p_name: string;
          p_brand_id: string;
          p_category_id: string | null;
          p_official_purchase_price: string;
          p_sku?: string | null;
          p_model_number?: string | null;
          p_metadata?: Json;
        };
        Returns: undefined;
      };
      save_device: { Args: { p_device_id: string | null; p_device: Json; p_financials: Json | null }; Returns: string };
      set_devices_status: { Args: { p_ids: string[]; p_status: DeviceStatus }; Returns: number };
      delete_devices: { Args: { p_ids: string[] }; Returns: number };
      request_price_syncs: {
        Args: { p_ids: string[] };
        Returns: Array<{ device_id: string; job_id: number | null; skipped: "not_found" | "not_linked" | "not_active" | "no_price" | null }>;
      };
      link_devices: { Args: { p_links: Json }; Returns: Array<{ device_id: string; linked: string[]; taken: string[] }> };
      import_erp_devices: {
        Args: { p_items: Json };
        Returns: Array<{ code: string; device_id: string; result: "created" | "linked" | "exists" | "price_updated" }>;
      };
      my_context: { Args: Record<string, never>; Returns: Json };
      role_permission_keys: { Args: { p_role: AppRole }; Returns: string[] };
      permission_matrix: { Args: Record<string, never>; Returns: PermissionMatrixRow[] };
      admin_set_role_permission: { Args: { p_role: AppRole; p_key: string; p_allowed: boolean }; Returns: undefined };
      admin_set_user_role: { Args: { p_target_user_id: string; p_new_role: AppRole }; Returns: undefined };
      admin_set_user_active: { Args: { p_target_user_id: string; p_is_active: boolean }; Returns: undefined };
      admin_log_user_invited: {
        Args: { p_user_id: string; p_email: string; p_role: AppRole; p_resent?: boolean };
        Returns: undefined;
      };
      update_my_profile: { Args: { p_full_name: string }; Returns: undefined };
      update_my_preferences: { Args: { p_theme?: string | null; p_locale?: string | null }; Returns: undefined };
      dashboard_summary: { Args: Record<string, never>; Returns: Json };
      brand_overview: { Args: { p_include_inactive?: boolean }; Returns: BrandOverviewRow[] };
      has_permission: { Args: { p_permission_key: string }; Returns: boolean };
    };
    Enums: {
      app_role: AppRole;
      device_status: DeviceStatus;
      discount_type: DiscountType;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
