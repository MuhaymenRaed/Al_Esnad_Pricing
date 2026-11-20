import { describe, expect, it } from "vitest";
import {
  filtersToSearchParams,
  parseFilters,
  sanitizeFilters,
  toRpcFilters,
  zonedDayStart,
} from "./devices";

const APPLE = "3f1c1f3c-5d2a-4a3b-9c1d-111111111111";
const SAMSUNG = "3f1c1f3c-5d2a-4a3b-9c1d-222222222222";

describe("device filters", () => {
  it("round-trips through the URL", () => {
    const filters = parseFilters(
      new URLSearchParams(`q=iphone&brand=${APPLE},${SAMSUNG}&min=2,000,000&max=3500000&sort=price_desc&recent=30d`),
    );
    expect(filters).toEqual({
      q: "iphone",
      brandIds: [APPLE, SAMSUNG],
      priceMin: "2000000",
      priceMax: "3500000",
      sort: "price_desc",
      recent: "30d",
    });
    expect(parseFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  it("drops invalid values instead of failing", () => {
    expect(parseFilters(new URLSearchParams("brand=not-a-uuid," + APPLE + "&min=abc&sort=evil"))).toEqual({
      brandIds: [APPLE],
    });
  });

  it("strips private filters and sorts for the catalogue projection", () => {
    const clean = sanitizeFilters(
      { priceField: "profit", priceMin: "1", sort: "profit_desc", statuses: ["draft"], q: "x" },
      "catalog",
    );
    expect(clean).toEqual({ q: "x" });
  });

  it("converts calendar days in the company time zone", () => {
    // Baghdad is UTC+3: local midnight is 21:00 UTC the previous day.
    expect(zonedDayStart("2026-03-10", "Asia/Baghdad")).toBe("2026-03-09T21:00:00.000Z");
    const rpc = toRpcFilters({ dateFrom: "2026-03-10", dateTo: "2026-03-10" }, "Asia/Baghdad");
    expect(rpc).toEqual({ createdFrom: "2026-03-09T21:00:00.000Z", createdTo: "2026-03-10T21:00:00.000Z" });
  });

  it("maps price ranges and selections", () => {
    expect(toRpcFilters({ priceMin: "10" }, "UTC", { ids: [APPLE] })).toEqual({
      priceField: "selling",
      priceMin: "10",
      ids: [APPLE],
    });
  });
});
