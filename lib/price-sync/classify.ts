/**
 * Brand and category of a device from its ERPNext / inventory name, e.g.
 * "شاومي REDMI NOTE 15 PRO 5G 256+12" → Xiaomi · Smartphones,
 * "HONOR PAD X8B 128+4" → Honor · Tablets, "NOKIA 105 S اصلي" → Nokia · Feature phones.
 *
 * Only phones and tablets are devices: gifts, pencils, chargers, watches,
 * earbuds, cases and the like are reported as skipped. A name no rule knows
 * is "unknown" — it is never guessed. Brand names match the app's brands
 * (compared without letter case).
 */
export type DeviceCategory = "Smartphones" | "Feature phones" | "Tablets";
export type SkipReason = "gift" | "accessory" | "watch" | "audio" | "case";
export type Classification =
  | { kind: "device"; brand: string; category: DeviceCategory }
  | { kind: "skip"; reason: SkipReason }
  | { kind: "unknown" };

const SKIP: Array<[RegExp, SkipReason]> = [
  [/gift|هدية|هديه/, "gift"],
  [/pencil|قلم/, "accessory"],
  [/apple power|charger|شاحن|cable|كيبل/, "accessory"],
  [/watch|whach|ساعة|ساعه/, "watch"],
  [/buds|airpods|earphone|headset|سماعة|سماعه/, "audio"],
  [/حافظه|حافظة|\bcase\b|cover|كفر/, "case"],
  [/مبرد|كوب|حلقه|بكج|جنطة|حقيبة|دفتر|شمسية|كرسي|coffe/, "gift"],
];

const TABLET = /\b(i?pad|tab)\b|\btab\d|\bt13\b/;

const RULES: Array<{ test: RegExp; brand: string; category?: DeviceCategory; tablets?: boolean }> = [
  { test: /nokia|nokai/, brand: "Nokia", category: "Feature phones" },
  { test: /\biphone\b/, brand: "Apple", category: "Smartphones" },
  { test: /\bipad\b/, brand: "Apple", category: "Tablets" },
  { test: /blackview|blackvieo/, brand: "Blackview", tablets: true },
  { test: /\bg[ _-]+_?tab\b|^g tab\b/, brand: "G-TAB" },
  { test: /\bhonor\b/, brand: "Honor", tablets: true },
  { test: /\bhotwav\b/, brand: "HOTWAV", category: "Smartphones" },
  { test: /\bhuawei\b/, brand: "Huawei", tablets: true },
  { test: /\binfinix\b/, brand: "Infinix", tablets: true },
  { test: /\bitel\b/, brand: "itel", category: "Smartphones" },
  { test: /\bkxd\b/, brand: "KXD", category: "Smartphones" },
  { test: /\blenovo\b/, brand: "Lenovo", tablets: true },
  { test: /\bmotorol[ao]\b|\bmoto\b/, brand: "Motorola", category: "Smartphones" },
  { test: /\boppo\b/, brand: "OPPO", tablets: true },
  { test: /\boukitel\b/, brand: "OUKITEL", category: "Smartphones" },
  { test: /\brealm[ei]\b/, brand: "realme", tablets: true },
  { test: /\bsams[ou]ng\b|\bgalaxy\b/, brand: "Samsung", tablets: true },
  { test: /\btecno\b/, brand: "TECNO", tablets: true },
  { test: /\bulefone\b/, brand: "Ulefone", category: "Smartphones" },
  { test: /\bvivo\b/, brand: "vivo", tablets: true },
  { test: /\bpoco\b|\bredmi\b|\bxiaomi\b|شاومي/, brand: "Xiaomi", tablets: true },
  { test: /\bzte\b|\bnubia\b/, brand: "ZTE", category: "Smartphones" },
  { test: /\bgoogle\b|\bpixel\b/, brand: "Google", tablets: true },
  { test: /\boneplus\b/, brand: "OnePlus", tablets: true },
  { test: /\bnothing\b|\bcmf\b/, brand: "Nothing", category: "Smartphones" },
];

export function classifyDevice(name: string): Classification {
  const n = name.toLowerCase();
  for (const [pattern, reason] of SKIP) if (pattern.test(n)) return { kind: "skip", reason };
  for (const rule of RULES) {
    if (!rule.test.test(n)) continue;
    if (rule.brand === "G-TAB") return { kind: "device", brand: "G-TAB", category: /\bmobile\b/.test(n) ? "Smartphones" : "Tablets" };
    const category = rule.category ?? (rule.tablets && TABLET.test(n) ? "Tablets" : "Smartphones");
    return { kind: "device", brand: rule.brand, category };
  }
  return { kind: "unknown" };
}
