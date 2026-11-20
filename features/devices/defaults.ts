import type { ManagedDeviceInitial } from "./components/managed-device-form";

/** Empty form state for a new managed device (server-safe module). */
export function emptyManagedDevice(): ManagedDeviceInitial {
  return {
    status: "active",
    basics: { name: "", brandId: "", categoryId: "", modelNumber: "", sku: "", metadata: [] },
    financials: { officialPurchasePrice: "", discountType: "percentage", discountValue: "", paybackAmount: "", companyProfit: "" },
  };
}
