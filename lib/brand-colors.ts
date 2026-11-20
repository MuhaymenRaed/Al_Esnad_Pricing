/** Coordinated palette used when a brand has no accent colour configured. */
export const BRAND_PALETTE = [
  "#DB1829", // Al-Esnad red
  "#23262C", // charcoal
  "#B5831C", // gold
  "#187C54", // green
  "#2563EB", // blue
  "#7C3AED", // violet
  "#C2185B", // magenta
  "#0E7490", // teal
];

/** Stable colour per brand: configured accent, else a palette entry from its name. */
export function brandColor(accent: string | null | undefined, name: string): string {
  if (accent && /^#[0-9A-Fa-f]{6}$/.test(accent)) return accent;
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BRAND_PALETTE[hash % BRAND_PALETTE.length];
}
