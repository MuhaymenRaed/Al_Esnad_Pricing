// Generated from the brand-logo import (see lib/brand-logos/SOURCES.md). Do not edit by hand.

/**
 * Official brand logos bundled with the app, keyed by normalised brand name.
 * `aspect` is width ÷ height of the logo's tight bounding box. The SVG files
 * live in /public/brand-logos; PDF shape data lives in ./paths (server only).
 */
export const BRAND_LOGOS = {
  "apple": { title: "Apple", aspect: 0.815 },
  "samsung": { title: "Samsung", aspect: 6.543 },
  "xiaomi": { title: "Xiaomi", aspect: 1.0 },
  "honor": { title: "Honor", aspect: 5.199 },
  "huawei": { title: "Huawei", aspect: 1.327 },
  "oppo": { title: "OPPO", aspect: 4.207 },
  "vivo": { title: "vivo", aspect: 3.813 },
  "oneplus": { title: "OnePlus", aspect: 1.0 },
  "google": { title: "Google", aspect: 0.974 },
  "motorola": { title: "Motorola", aspect: 1.0 },
  "nokia": { title: "Nokia", aspect: 4.25 },
  "lenovo": { title: "Lenovo", aspect: 2.998 },
  "tecno": { title: "TECNO", aspect: 4.998 },
  "zte": { title: "ZTE", aspect: 2.069 },
  "realme": { title: "realme", aspect: 3.333 },
  "infinix": { title: "Infinix", aspect: 4.613 },
  "itel": { title: "itel", aspect: 1.579 },
  "nothing": { title: "Nothing", aspect: 5.569 },
} as const;

export type BrandLogoKey = keyof typeof BRAND_LOGOS;

const ALIASES: Record<string, BrandLogoKey> = {
  "googlepixel": "google",
  "pixel": "google",
  "moto": "motorola",
  "motorolamobility": "motorola",
  "hmd": "nokia",
  "hmdglobal": "nokia",
  "nokiahmd": "nokia",
  "mi": "xiaomi",
  "honormobile": "honor",
  "oneplusnord": "oneplus",
  "tecnomobile": "tecno",
  "infinixmobile": "infinix",
  "infinixmobility": "infinix",
  "itelmobile": "itel",
  "nothingphone": "nothing",
  "nothingtechnology": "nothing",
  "zteblade": "zte",
};

const normalise = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** The bundled logo for a brand name ("OnePlus", "HONOR", "Google Pixel"…), if there is one. */
export function brandLogoKey(name: string | null | undefined): BrandLogoKey | null {
  if (!name) return null;
  const n = normalise(name);
  if (n in BRAND_LOGOS) return n as BrandLogoKey;
  return ALIASES[n] ?? null;
}

export function brandLogoSrc(key: BrandLogoKey) {
  return `/brand-logos/${key}.svg`;
}
