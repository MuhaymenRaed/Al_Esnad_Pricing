import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Readex_Pro } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { InlineScript } from "@/components/providers/inline-script";
import { LOCALE_SCRIPT } from "@/lib/i18n/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const readex = Readex_Pro({ variable: "--font-readex", subsets: ["latin", "arabic"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Al-Esnad Pricing", template: "%s · Al-Esnad Pricing" },
  description: "Device pricing, cost management and selling price management for Al-Esnad Company.",
  applicationName: "Al-Esnad Pricing",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${readex.variable} h-full`}
    >
      <head>
        <InlineScript html={LOCALE_SCRIPT} />
      </head>
      <body className="min-h-full">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
