import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { pushAlisnadPrice, searchAlisnad } = await import("./alisnad");
const { clearErpnextCache, fetchErpDevices, lookupErpnext, pushErpnextPrice } = await import("./erpnext");

type Call = { url: string; method: string; body: unknown };
type Handler = (url: URL, method: string, body: unknown) => [number, unknown] | undefined;

/** A fake fetch answering by URL and method; anything unexpected is a 500. */
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), method, body });
    const [status, json] = handler(url, method, body) ?? [500, { error: "unexpected call" }];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const filtersOf = (url: URL) => JSON.parse(url.searchParams.get("filters") ?? "[]") as unknown[][];
const isList = (url: URL, doctype: string) => url.pathname === `/api/resource/${encodeURIComponent(doctype)}`;

const ALISNAD = { url: "https://alisnad.example.supabase.co", key: "service-key" };
const ERP = {
  url: "https://erp.example.com",
  key: "k123",
  secret: "s456",
  sellingList: "Al-Esnad Selling",
  buyingList: "الاسناد",
  itemGroups: ["الأجهزة"],
  company: "الاسناد",
};
const COMPANY = ["Item Default", "company", "=", "الاسناد"];
const SITE = "ERPN-BEA7FDBA74";
const BLACK = "DEV-000199";
const GREY = "DEV-000200";

beforeEach(() => clearErpnextCache());

describe("alisnad.iq", () => {
  it("updates base_price of matching products only where it differs", async () => {
    const { fn, calls } = fakeFetch((url, method) => {
      if (method === "GET")
        return [
          200,
          [
            { id: "p1", name_en: "Spark 50 256GB", base_price: 370000, erp_item_code: SITE, is_active: true },
            { id: "p2", name_en: "Spark 50 256GB (Used)", base_price: 371000, erp_item_code: "ERPN-OTHER", is_active: true },
          ],
        ];
      if (method === "PATCH") return [200, [{ id: "p1", name_en: "Spark 50 256GB", base_price: 371000, erp_item_code: SITE }]];
    });
    const result = await pushAlisnadPrice(ALISNAD, [SITE, "ERPN-OTHER", BLACK], 371000, fn);
    expect(result).toEqual({
      status: "updated",
      missing: [BLACK],
      items: [
        { code: "ERPN-OTHER", name: "Spark 50 256GB (Used)", selling: { old: 371000, new: 371000, action: "unchanged" } },
        { code: SITE, name: "Spark 50 256GB", selling: { old: 370000, new: 371000, action: "updated" } },
      ],
    });
    // Codes are quoted inside the PostgREST "in" list (they contain spaces and "+").
    expect(decodeURIComponent(calls[0].url)).toContain(`erp_item_code=in.("${SITE}","ERPN-OTHER","${BLACK}")&is_deleted=is.false`);
    expect(decodeURIComponent(calls[1].url)).toContain(`erp_item_code=in.("${SITE}")&is_deleted=is.false`);
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body).toEqual({ base_price: 371000 });
  });

  it("does nothing when prices already match, reports missing codes and failures", async () => {
    const same = fakeFetch(() => [200, [{ id: "p1", name_en: "X", base_price: "371000", erp_item_code: SITE }]]);
    expect(await pushAlisnadPrice(ALISNAD, [SITE], 371000, same.fn)).toMatchObject({ status: "unchanged", missing: [] });
    expect(same.calls).toHaveLength(1);
    const none = fakeFetch(() => [200, []]);
    expect(await pushAlisnadPrice(ALISNAD, [BLACK], 1, none.fn)).toEqual({ status: "not_found", missing: [BLACK] });
    const denied = fakeFetch(() => [401, { message: "Invalid API key" }]);
    expect(await pushAlisnadPrice(ALISNAD, [SITE], 1, denied.fn)).toMatchObject({ status: "error", error: expect.stringContaining("HTTP 401") });
  });

  it("searches names, SKUs and codes word by word", async () => {
    const { fn, calls } = fakeFetch(() => [200, [{ id: "p1", name_en: "Nokia 150 (2024)", base_price: 27000, erp_item_code: "ERPN-1", is_active: false }]]);
    expect(await searchAlisnad(ALISNAD, 'nokia "150', fn)).toEqual([{ code: "ERPN-1", name: "Nokia 150 (2024)", active: false, selling: 27000 }]);
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain('and=(or(name_en.ilike."*nokia*",name_ar.ilike."*nokia*",sku.ilike."*nokia*",erp_item_code.ilike."*nokia*"),or(name_en.ilike."*150*"');
    expect(url).toContain("erp_item_code=not.is.null");
  });
});

describe("ERPNext", () => {
  const items = [
    { item_code: BLACK, item_name: "TECNO SPARK 50 256+4 BLACK", disabled: 0 },
    { item_code: GREY, item_name: "TECNO SPARK 50 256+4 GREY", disabled: 0 },
  ];

  it("sets the selling price in the selling list and the purchase price in the buying list", async () => {
    const { fn, calls } = fakeFetch((url, method) => {
      if (method === "GET" && isList(url, "Item")) return [200, { data: items }];
      if (method === "GET" && isList(url, "Item Price"))
        return [
          200,
          {
            data: [
              { name: "IP-S1", item_code: BLACK, price_list: ERP.sellingList, price_list_rate: 300000, currency: "IQD" },
              { name: "IP-B1", item_code: BLACK, price_list: ERP.buyingList, price_list_rate: 295000, currency: "IQD" },
              { name: "IP-B2", item_code: GREY, price_list: ERP.buyingList, price_list_rate: 290000, currency: "IQD" },
              // Customer-specific prices are never touched.
              { name: "IP-C", item_code: GREY, price_list: ERP.sellingList, price_list_rate: 1, currency: "IQD", customer: "Shop A" },
            ],
          },
        ];
      if (method === "GET" && url.pathname.startsWith("/api/resource/Price%20List/")) return [200, { data: { currency: "IQD" } }];
      if (method === "PUT" || method === "POST") return [200, { data: {} }];
    });
    const result = await pushErpnextPrice(ERP, [BLACK, GREY, SITE], { selling: 320000, buying: 295000 }, "IQD", fn);
    expect(result).toEqual({
      status: "updated",
      missing: [SITE],
      items: [
        {
          code: BLACK,
          name: "TECNO SPARK 50 256+4 BLACK",
          selling: { old: 300000, new: 320000, action: "updated" },
          buying: { old: 295000, new: 295000, action: "unchanged" },
        },
        {
          code: GREY,
          name: "TECNO SPARK 50 256+4 GREY",
          selling: { old: null, new: 320000, action: "created" },
          buying: { old: 290000, new: 295000, action: "updated" },
        },
      ],
    });
    const priceRead = calls.find((c) => c.method === "GET" && isList(new URL(c.url), "Item Price"))!;
    expect(filtersOf(new URL(priceRead.url))).toEqual([
      ["item_code", "in", [BLACK, GREY, SITE]],
      ["price_list", "in", [ERP.sellingList, ERP.buyingList]],
    ]);
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toEqual(
      expect.arrayContaining([
        { url: `${ERP.url}/api/resource/Item%20Price/IP-S1`, method: "PUT", body: { price_list_rate: 320000 } },
        { url: `${ERP.url}/api/resource/Item%20Price`, method: "POST", body: { item_code: GREY, price_list: ERP.sellingList, price_list_rate: 320000 } },
        { url: `${ERP.url}/api/resource/Item%20Price/IP-B2`, method: "PUT", body: { price_list_rate: 295000 } },
      ]),
    );
    expect(writes).toHaveLength(3);
    expect(calls.every((c) => c.url.startsWith(ERP.url))).toBe(true);
    // Other companies' Items are never visible: every Item read is limited to Al-Esnad.
    const itemReads = calls.filter((c) => isList(new URL(c.url), "Item"));
    expect(itemReads.length).toBeGreaterThan(0);
    expect(itemReads.every((c) => JSON.stringify(filtersOf(new URL(c.url)).at(-1)) === JSON.stringify(COMPANY))).toBe(true);
  });

  it("never writes selling prices when no separate selling list is set", async () => {
    const { fn, calls } = fakeFetch((url, method) => {
      if (method === "GET" && isList(url, "Item")) return [200, { data: [items[0]] }];
      if (method === "GET" && isList(url, "Item Price"))
        return [200, { data: [{ name: "IP-B1", item_code: BLACK, price_list: "الاسناد", price_list_rate: 54000, currency: "IQD" }] }];
      if (method === "PUT") return [200, { data: {} }];
    });
    const result = await pushErpnextPrice({ ...ERP, sellingList: null }, [BLACK], { selling: 60000, buying: 55000 }, "IQD", fn);
    expect(result).toMatchObject({ status: "updated", items: [{ code: BLACK, buying: { old: 54000, new: 55000, action: "updated" } }] });
    expect((result as { items: Array<Record<string, unknown>> }).items[0].selling).toBeUndefined();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([{ url: `${ERP.url}/api/resource/Item%20Price/IP-B1`, method: "PUT", body: { price_list_rate: 55000 } }]);
  });

  it("refuses a price list in another currency before writing anything", async () => {
    const rows = fakeFetch((url, method) => {
      if (method === "GET" && isList(url, "Item")) return [200, { data: [items[0]] }];
      if (method === "GET" && isList(url, "Item Price")) return [200, { data: [{ name: "IP-1", item_code: BLACK, price_list: ERP.sellingList, price_list_rate: 250, currency: "USD" }] }];
    });
    expect(await pushErpnextPrice(ERP, [BLACK], { selling: 371000, buying: null }, "IQD", rows.fn)).toMatchObject({ status: "error", error: expect.stringContaining("USD") });
    expect(rows.calls.filter((c) => c.method !== "GET")).toHaveLength(0);

    const list = fakeFetch((url, method) => {
      if (method === "GET" && isList(url, "Item")) return [200, { data: [items[0]] }];
      if (method === "GET" && isList(url, "Item Price")) return [200, { data: [] }];
      if (method === "GET" && url.pathname.startsWith("/api/resource/Price%20List/")) return [200, { data: { currency: "USD" } }];
    });
    expect(await pushErpnextPrice(ERP, [BLACK], { selling: 1, buying: null }, "IQD", list.fn)).toMatchObject({ status: "error", error: expect.stringContaining("USD") });
    expect(list.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("looks items up with their prices, enabled flag and missing codes", async () => {
    const { fn } = fakeFetch((url) => {
      if (isList(url, "Item")) return [200, { data: [{ ...items[0], disabled: 1 }] }];
      if (isList(url, "Item Price"))
        return [
          200,
          {
            data: [
              { name: "a", item_code: BLACK, price_list: ERP.buyingList, price_list_rate: 307727.5862, currency: "IQD" },
              { name: "b", item_code: BLACK, price_list: ERP.sellingList, price_list_rate: 320000, currency: "IQD" },
              { name: "c", item_code: BLACK, price_list: ERP.sellingList, price_list_rate: 330000, currency: "IQD" },
            ],
          },
        ];
    });
    const found = await lookupErpnext(ERP, [BLACK, SITE], "IQD", fn);
    // Two general selling prices that disagree: no single price (shows as "differs").
    expect(found.get(BLACK)).toEqual({ code: BLACK, name: "TECNO SPARK 50 256+4 BLACK", active: false, selling: null, buying: 307727.5862 });
    expect(found.has(SITE)).toBe(false);
  });

  it("fetches every device item of the company with its purchase price (paged)", async () => {
    // Live setup: selling list الاسناد (where items were created with their purchase price), buying list Standard Buying.
    const target = { ...ERP, sellingList: "الاسناد", buyingList: "Standard Buying" };
    const page1 = Array.from({ length: 500 }, (_, i) => ({ item_code: `DEV-${String(i + 1).padStart(6, "0")}`, item_name: ` Item ${i + 1} `, item_group: "الأجهزة", disabled: 0 }));
    const page2 = [{ item_code: "DEV-000501", item_name: "HONOR X9D 256+12GB", item_group: "الأجهزة", disabled: 0 }];
    const { fn, calls } = fakeFetch((url) => {
      if (isList(url, "Item")) return [200, { data: url.searchParams.get("limit_start") === "0" ? page1 : page2 }];
      if (isList(url, "Item Price")) {
        const codes = filtersOf(url)[0][2] as string[];
        const data = [];
        if (codes.includes("DEV-000002")) data.push({ name: "s2", item_code: "DEV-000002", price_list: "الاسناد", price_list_rate: 54000, currency: "IQD" });
        if (codes.includes("DEV-000501")) {
          // Published once: الاسناد now holds the selling price, Standard Buying the purchase price.
          data.push({ name: "s", item_code: "DEV-000501", price_list: "الاسناد", price_list_rate: 600000, currency: "IQD" });
          data.push({ name: "b", item_code: "DEV-000501", price_list: "Standard Buying", price_list_rate: 548000, currency: "IQD" });
        }
        return [200, { data }];
      }
    });
    const devices = await fetchErpDevices(target, fn);
    expect(devices).toHaveLength(501);
    expect(devices[0]).toEqual({ code: "DEV-000001", name: "Item 1", group: "الأجهزة", disabled: false, rate: null, source: null, currency: null });
    expect(devices[1]).toMatchObject({ code: "DEV-000002", rate: 54000, source: "selling" });
    expect(devices[500]).toEqual({ code: "DEV-000501", name: "HONOR X9D 256+12GB", group: "الأجهزة", disabled: false, rate: 548000, source: "buying", currency: "IQD" });
    const itemCall = new URL(calls[0].url);
    expect(filtersOf(itemCall)).toEqual([["item_group", "in", ["الأجهزة"]], COMPANY]);
    expect(itemCall.searchParams.get("order_by")).toBe("`tabItem`.name asc");
    // Prices are read 40 codes at a time from both lists.
    const priceCalls = calls.filter((c) => isList(new URL(c.url), "Item Price"));
    expect(priceCalls).toHaveLength(Math.ceil(501 / 40));
    expect(filtersOf(new URL(priceCalls[0].url))[1]).toEqual(["price_list", "in", ["الاسناد", "Standard Buying"]]);
  });
});
