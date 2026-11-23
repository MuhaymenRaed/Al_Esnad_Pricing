import { describe, expect, it } from "vitest";
import { deriveDeviceSync, deriveSystemSync, type SyncCompare, type SyncStateRow } from "./sync-state";

const COMPARE: SyncCompare = { alisnad: true, erpnext: true, erpSelling: false, erpBuying: true, decimals: 0 };
const row = (target: "alisnad" | "erpnext", items: unknown[], extra: Partial<SyncStateRow> = {}): SyncStateRow => ({
  device_id: "d1",
  target,
  codes: ["DEV-1"],
  items,
  error: null,
  checked_at: "2026-11-22T10:00:00Z",
  published_at: null,
  ...extra,
});

const erp = (r: SyncStateRow | undefined, selling = 60000, purchase: number | null = 54000, compare = COMPARE) =>
  deriveSystemSync({ system: "erpnext", compare, codes: ["DEV-1"], row: r, selling, purchase }).state;

describe("publishing status", () => {
  it("reads not linked / not checked / missing / error", () => {
    expect(deriveSystemSync({ system: "erpnext", compare: COMPARE, codes: [], row: undefined, selling: 1, purchase: 1 }).state).toBe("unlinked");
    expect(erp(undefined)).toBe("unchecked");
    expect(erp(row("erpnext", [], { codes: ["OLD"] }))).toBe("unchecked");
    expect(erp(row("erpnext", []))).toBe("missing");
    expect(erp(row("erpnext", [], { error: "HTTP 500" }))).toBe("error");
    expect(erp(row("erpnext", []), 1, 1, { ...COMPARE, erpnext: false })).toBe("off");
  });

  it("compares the ERPNext purchase price after rounding to the currency", () => {
    const item = { code: "DEV-1", name: "HUAWEI NOVA 7i", active: true, selling: null, buying: 307727.5862 };
    expect(erp(row("erpnext", [item]), 400000, 307728)).toBe("synced");
    expect(erp(row("erpnext", [item]), 400000, 300000)).toBe("outdated");
    // With a selling list, the selling price must match too.
    expect(erp(row("erpnext", [item]), 400000, 307728, { ...COMPARE, erpSelling: true })).toBe("outdated");
    expect(erp(row("erpnext", [{ ...item, selling: 400000 }]), 400000, 307728, { ...COMPARE, erpSelling: true })).toBe("synced");
  });

  it("checks alisnad.iq against the final selling price and spots hidden products", () => {
    const sync = deriveDeviceSync({
      compare: COMPARE,
      codes: ["DEV-1", "ERPN-1"],
      rows: [
        row("alisnad", [{ code: "ERPN-1", name: "Nokia 150", active: true, selling: 27000 }], { codes: ["ERPN-1", "DEV-1"] }),
        row("erpnext", [{ code: "DEV-1", name: "Nokia 150", active: false, selling: null, buying: 14250 }], { codes: ["DEV-1", "ERPN-1"] }),
      ],
      selling: 28000,
      purchase: 14250,
    });
    expect(sync.alisnad.state).toBe("outdated");
    expect(sync.erpnext.state).toBe("hidden");
  });
});
