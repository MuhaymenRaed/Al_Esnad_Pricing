import Image from "next/image";
import { BRAND_LOGOS, brandLogoKey, brandLogoSrc } from "@/lib/brand-logos";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: { plate: "h-6 w-12 rounded-md px-1.5 py-1", text: "text-[0.55rem]" },
  sm: { plate: "h-8 w-16 rounded-md px-2 py-1.5", text: "text-[0.66rem]" },
  md: { plate: "h-11 w-[5.5rem] rounded-lg px-2.5 py-2", text: "text-xs" },
  lg: { plate: "h-14 w-28 rounded-xl px-3 py-2.5", text: "text-sm" },
} as const;

/**
 * A brand's logo on a white plate, the same in light and dark mode so every
 * official colour stays legible. Order of preference: the logo URL an
 * administrator set on the brand, the bundled official logo, then a text
 * wordmark in the brand colour. Decorative by default (the brand name is
 * normally shown next to it); pass `label` when the logo stands alone.
 */
export function BrandLogo({
  name,
  color,
  logoUrl,
  size = "md",
  label,
  className,
}: {
  name: string;
  color?: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  label?: string;
  className?: string;
}) {
  const key = logoUrl ? null : brandLogoKey(name);
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-black/8 bg-white shadow-xs dark:border-white/10",
        s.plate,
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-provided https logo
        <img src={logoUrl} alt="" className="size-full object-contain" />
      ) : key ? (
        <Image
          src={brandLogoSrc(key)}
          alt=""
          width={Math.round(48 * BRAND_LOGOS[key].aspect)}
          height={48}
          unoptimized
          className="size-full object-contain"
        />
      ) : (
        <span className={cn("truncate font-heading font-bold tracking-tight", s.text)} style={{ color: color ?? "#23262C" }}>
          {name}
        </span>
      )}
    </span>
  );
}
