import { describe, expect, it } from "vitest";
import { classifyDevice } from "./classify";

const device = (brand: string, category: string) => ({ kind: "device", brand, category });

describe("classifyDevice", () => {
  it.each([
    ["215 اصليNOKIA N", device("Nokia", "Feature phones")],
    ["NOKAI 110 2026 دبي", device("Nokia", "Feature phones")],
    ["-NOKIA N 5710 اصلي", device("Nokia", "Feature phones")],
    ["IPhone 16 Pro Max 256 Desert Titanium ماستر", device("Apple", "Smartphones")],
    ["IPAD PRO 11 M5 256GB 2025", device("Apple", "Tablets")],
    ["BLACKVIEO TAB LINK 1 KIDS 64+4", device("Blackview", "Tablets")],
    ["Blackview Tab60 128+4GB", device("Blackview", "Tablets")],
    ["BLACKVIEW WAVE 7C 64+4", device("Blackview", "Smartphones")],
    ["G _TAB G10 MOBILE 128+4", device("G-TAB", "Smartphones")],
    ["G TAB PAD 7 64+3", device("G-TAB", "Tablets")],
    ["G-TAB T13 PRO 128+4", device("G-TAB", "Tablets")],
    ["HONOR CHOICE T10 32+3", device("Honor", "Smartphones")],
    ["HONOR PAD X8B 128+4 ازرق", device("Honor", "Tablets")],
    ["HOTWAV NOTE 18 PRO 128+6", device("HOTWAV", "Smartphones")],
    ["HUAWEI NOVA 7i 128-8 GB", device("Huawei", "Smartphones")],
    ["infinix smart 10 128+4 GB", device("Infinix", "Smartphones")],
    ["ITEL CITY 200 256+4", device("itel", "Smartphones")],
    ["KXD A07 PRO 64+3", device("KXD", "Smartphones")],
    ["LENOVO K12 64 GB + 4", device("Lenovo", "Smartphones")],
    ["MOTOROLO G60 S 128 GB + 6", device("Motorola", "Smartphones")],
    ["OPPO RENO 16F 256+8", device("OPPO", "Smartphones")],
    ["Oukitel C21 Plus 128+8", device("OUKITEL", "Smartphones")],
    ["POCO PAD C 1 128+6 شاومي", device("Xiaomi", "Tablets")],
    ["شاومي Redmi pad 2 wifi 256+8", device("Xiaomi", "Tablets")],
    ["شاومي MI 17 T PRO 1T+12", device("Xiaomi", "Smartphones")],
    ["REALMI C85 PRO 256+8GB", device("realme", "Smartphones")],
    ["SAMSONG S26 ULTRA 256+12 ازرق", device("Samsung", "Smartphones")],
    ["SAMSUNG TAB A11 PLUS 5G 128+6", device("Samsung", "Tablets")],
    ["TECNO MEGA PAD SE 256+8", device("TECNO", "Tablets")],
    ["TECNO POP7 64+2ا ازرق", device("TECNO", "Smartphones")],
    ["Ulefone 11P 128GB+8", device("Ulefone", "Smartphones")],
    ["VIVO Y53S 128 + 8", device("vivo", "Smartphones")],
    ["ZTE NUBIA A77 128+4", device("ZTE", "Smartphones")],
  ])("%s", (name, expected) => {
    expect(classifyDevice(name)).toEqual(expected);
  });

  it.each([
    ["ALL CALL BUDS C1 GIFT", "gift"],
    ["APPEL PENCIL PRO(USB-C)1", "accessory"],
    ["apple power 20W", "accessory"],
    ["APPLE WATCH S9 45 MM", "watch"],
    ["G TAB SMART WHACH GT8", "watch"],
    ["HONOR CHOICE WATCH 2 PRO", "watch"],
    ["سماعة APPEL AirPods-4 ماستر", "audio"],
    ["MAGIC 8 PRO حافظه", "case"],
    ["كرسي infinx gift", "gift"],
    ["بكج قهوه انفنكس", "gift"],
  ])("skips %s", (name, reason) => {
    expect(classifyDevice(name)).toEqual({ kind: "skip", reason });
  });

  it("never guesses an unknown brand", () => {
    expect(classifyDevice("Super Phone X1 128+4")).toEqual({ kind: "unknown" });
  });
});
