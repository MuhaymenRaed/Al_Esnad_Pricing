import path from "node:path";
import { Circle, Document, Font, Page, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { brandLogoKey } from "@/lib/brand-logos";
import { BRAND_LOGO_PATHS } from "@/lib/brand-logos/paths";
import { formatNumber } from "@/lib/format";
import { createT, type Locale } from "@/lib/i18n/core";

/*
 * Corporate PDF report (server-side only), written in the language of the
 * user who requests it. Arabic reports are laid out right-to-left: rows run
 * from the right (`row-reverse`) and every text node carries the paragraph
 * direction so the bidi algorithm orders mixed Arabic / Latin / number runs.
 * Typography: IBM Plex Sans Arabic (Arabic + Latin, OFL). The data passed in
 * has already been restricted to what the requesting role may see.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Plex",
    fonts: [
      { src: path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "IBMPlexSansArabic-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "IBMPlexSansArabic-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const C = {
  brand: "#DB1829",
  mark: "#E11D2E",
  night: "#16171B",
  charcoal: "#23262C",
  ink: "#1B1B1F",
  muted: "#6B6B74",
  faint: "#A1A1AA",
  line: "#E6E6EA",
  soft: "#F4F4F6",
  zebra: "#FAFAFB",
  gold: "#8F6714",
  goldSoft: "#FBF6EA",
  success: "#187C54",
  successSoft: "#EBF7F1",
  brandSoft: "#FDEDEF",
  white: "#FFFFFF",
};

const s = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 8.6, color: C.ink, paddingTop: 68, paddingBottom: 58, paddingHorizontal: 36 },
  coverPage: { fontFamily: "Plex", fontSize: 8.6, color: C.ink, paddingTop: 0, paddingBottom: 58, paddingHorizontal: 0 },
  // chrome
  header: { position: "absolute", top: 22, left: 36, right: 36, alignItems: "center", justifyContent: "space-between", paddingBottom: 9, borderBottomWidth: 0.6, borderBottomColor: C.line },
  headerAccent: { position: "absolute", bottom: -0.9, width: 46, height: 1.8, backgroundColor: C.brand, borderRadius: 1 },
  headerCompany: { fontSize: 8.4, fontWeight: 600, color: C.ink },
  headerTagline: { fontSize: 6.6, color: C.muted, marginTop: 1 },
  headerTitle: { fontSize: 8.4, fontWeight: 600, color: C.muted },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, alignItems: "center", borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 8 },
  footerText: { fontSize: 7, color: C.muted },
  confidential: { color: C.brand, fontWeight: 700 },
  // cover
  band: { backgroundColor: C.night, paddingHorizontal: 36, paddingTop: 40, paddingBottom: 34, position: "relative", overflow: "hidden" },
  bandAccent: { position: "absolute", bottom: 0, height: 4, width: 140, backgroundColor: C.brand },
  coverCompany: { fontSize: 15, fontWeight: 700, color: C.white },
  coverTagline: { fontSize: 8.4, color: "#B4B4BE", marginTop: 2 },
  coverTitle: { fontSize: 27, fontWeight: 700, color: C.white, lineHeight: 1.25 },
  coverSubtitle: { fontSize: 11.5, color: "#FF8E99", marginTop: 6, fontWeight: 500 },
  coverDate: { fontSize: 8.6, color: "#C9C9D1", marginTop: 12 },
  badge: { fontSize: 7.6, color: C.white, backgroundColor: C.brand, borderRadius: 5, paddingVertical: 4, paddingHorizontal: 9, marginTop: 14, maxWidth: 420 },
  coverBody: { paddingHorizontal: 36, paddingTop: 22 },
  blockTitle: { fontSize: 10, fontWeight: 700, color: C.charcoal, marginTop: 18, marginBottom: 8 },
  grid: { flexWrap: "wrap", gap: 8 },
  card: { borderWidth: 0.6, borderColor: C.line, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: C.white },
  cardLabel: { fontSize: 7.2, color: C.muted },
  cardValue: { fontSize: 12, fontWeight: 700, marginTop: 3, color: C.ink },
  kpi: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 11, borderWidth: 0.6, borderColor: C.line, backgroundColor: C.zebra },
  kpiValue: { fontSize: 12.5, fontWeight: 700, marginTop: 4 },
  brandTile: { borderWidth: 0.6, borderColor: C.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 7, alignItems: "center", gap: 8, backgroundColor: C.white },
  brandName: { fontSize: 9, fontWeight: 700, color: C.ink },
  brandCount: { fontSize: 7.2, color: C.muted, marginTop: 1 },
  chip: { fontSize: 7.6, backgroundColor: C.soft, borderRadius: 10, paddingVertical: 3.5, paddingHorizontal: 8, color: C.charcoal },
  notice: { marginTop: 16, padding: 10, borderRadius: 8, backgroundColor: C.brandSoft, color: "#9F1220", fontSize: 8 },
  // sections
  section: { marginBottom: 20 },
  sectionHead: { alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9, borderWidth: 0.6, borderColor: C.line, backgroundColor: C.white, marginBottom: 7, position: "relative", overflow: "hidden" },
  sectionAccent: { position: "absolute", top: 0, bottom: 0, width: 4 },
  sectionTitle: { fontSize: 13.5, fontWeight: 700, color: C.ink },
  sectionMeta: { fontSize: 7.6, color: C.muted, marginTop: 1 },
  sectionStatLabel: { fontSize: 7, color: C.muted },
  sectionStatValue: { fontSize: 11, fontWeight: 700, color: C.brand, marginTop: 1 },
  th: { backgroundColor: C.charcoal, borderRadius: 5, paddingVertical: 6.5, paddingHorizontal: 6, alignItems: "flex-end" },
  thText: { fontSize: 7.4, fontWeight: 600, color: C.white },
  thUnit: { fontSize: 6, color: "#B4B4BE", marginTop: 0.5 },
  tr: { paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line, alignItems: "center" },
  cellText: { fontSize: 8.4 },
  cellSub: { fontSize: 6.8, color: C.muted, marginTop: 1.5 },
  totalRow: { paddingVertical: 7.5, paddingHorizontal: 6, backgroundColor: C.soft, borderRadius: 5, marginTop: 4, alignItems: "center" },
  grandRow: { paddingVertical: 9, paddingHorizontal: 6, backgroundColor: C.charcoal, borderRadius: 6, alignItems: "center" },
});

export type ReportColumn = {
  key: string;
  label: string;
  /** Small line under the header label, e.g. the currency. */
  unit?: string;
  width: number; // flex basis (relative)
  /** Amounts: aligned to the end of the cell in both directions. */
  numeric?: boolean;
  tone?: "brand" | "gold" | "success" | "muted";
  bold?: boolean;
  total?: boolean;
};

export type ReportCell = { text: string; sub?: string };
export type ReportRow = { id: string; cells: Record<string, ReportCell> };
export type ReportSection = {
  brandName: string;
  brandColor: string;
  /** False when the report is not grouped by brand ("All devices"). */
  isBrand?: boolean;
  rows: ReportRow[];
  totals?: Record<string, string>;
  countLabel: string;
};

type Tone = "brand" | "gold" | "success";

export type ReportDocumentProps = {
  locale: Locale;
  company: { name: string; tagline: string | null; footer: string | null };
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy: string;
  scopeLabel: string;
  filters: string[];
  columns: ReportColumn[];
  sections: ReportSection[];
  totalRecords: number;
  grandTotals?: Record<string, string>;
  coverStats?: Array<{ label: string; value: string; tone?: Tone }>;
  orientation: "portrait" | "landscape";
  includeCover: boolean;
  brandPageBreaks: boolean;
  confidential: boolean;
  truncated: boolean;
  currency: string;
};

const DIAMOND =
  "M24 0 L48 24 L24 48 L0 24 Z M20.808 15.876 L22.769 17.836 L32.302 8.302 L30.342 6.342 Z M30.164 25.232 L32.124 27.192 L41.658 17.658 L39.698 15.698 Z";

/** Al-Esnad mark — same geometry as app/icon.svg (dot pre-transformed into tile space). */
function Mark({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Rect width="48" height="48" rx="10.5" fill="#333333" />
      <Path transform="translate(6.72 6.72) scale(0.72)" d={DIAMOND} fill="#FFFFFF" fillRule="evenodd" />
      <Circle cx="21.6" cy="26.395" r="4.627" fill={C.mark} />
    </Svg>
  );
}

/** A brand's official logo on a white plate; text wordmark when none is bundled. */
function LogoPlate({ name, color, width, height }: { name: string; color: string; width: number; height: number }) {
  const key = brandLogoKey(name);
  const geo = key ? BRAND_LOGO_PATHS[key] : null;
  const padX = height * 0.24;
  const padY = height * 0.2;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  let content: ReactNode;
  if (geo) {
    const aspect = geo.width / geo.height;
    const wide = aspect > innerW / innerH;
    const w = wide ? innerW : innerH * aspect;
    const h = wide ? innerW / aspect : innerH;
    content = (
      <Svg width={w} height={h} viewBox={geo.viewBox}>
        {geo.shapes.map((shape, i) => (
          <Path key={i} d={shape.d} fill={shape.fill} fillRule={shape.fillRule} />
        ))}
      </Svg>
    );
  } else {
    const fontSize = Math.max(5, Math.min(height * 0.36, (innerW / Math.max(name.length, 1)) * 1.7));
    content = <Text style={{ fontSize, fontWeight: 700, color }}>{name}</Text>;
  }
  return (
    <View
      style={{
        width,
        height,
        borderRadius: Math.min(8, height * 0.26),
        backgroundColor: C.white,
        borderWidth: 0.6,
        borderColor: C.line,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {content}
    </View>
  );
}

function toneColor(tone?: ReportColumn["tone"]) {
  return tone === "brand" ? C.brand : tone === "gold" ? C.gold : tone === "success" ? C.success : tone === "muted" ? C.muted : C.ink;
}

export function ReportDocument(props: ReportDocumentProps) {
  registerFonts();
  const t = createT(props.locale);
  const rtl = props.locale === "ar";
  const { columns, sections } = props;
  const landscape = props.orientation === "landscape";

  // Direction helpers: rows mirror in Arabic; every text node gets the paragraph direction.
  const row = { flexDirection: rtl ? ("row-reverse" as const) : ("row" as const) };
  const start = { direction: rtl ? ("rtl" as const) : ("ltr" as const), textAlign: rtl ? ("right" as const) : ("left" as const) };
  const end = { direction: rtl ? ("rtl" as const) : ("ltr" as const), textAlign: rtl ? ("left" as const) : ("right" as const) };
  const center = { direction: rtl ? ("rtl" as const) : ("ltr" as const), textAlign: "center" as const };
  const edge = rtl ? { right: 0 } : { left: 0 };
  const farEdge = rtl ? { left: -70 } : { right: -70 };
  const latinCaps = rtl ? {} : { textTransform: "uppercase" as const, letterSpacing: 0.5 };

  const perRow = (portrait: number, wide: number) => `${(100 - (landscape ? wide : portrait) * 1.6) / (landscape ? wide : portrait)}%`;
  // Landscape covers have less height: tighter spacing between blocks.
  const blockGap = landscape ? { marginTop: 12, marginBottom: 6 } : {};
  const brandCount = sections.filter((x) => x.isBrand !== false).length;

  const cell = (col: ReportColumn) => ({ flexGrow: col.width, flexBasis: 0, paddingHorizontal: 4 });

  const footer = (
    <View style={[s.footer, row]} fixed>
      <Text style={[start, s.footerText, { flexGrow: 1, flexBasis: 0 }]}>
        {props.confidential ? <Text style={s.confidential}>{t("pdf.confidential")} · </Text> : null}
        {props.company.footer ?? t("pdf.internalDocument", { company: props.company.name })}
      </Text>
      <Text style={[center, s.footerText, { flexGrow: 1, flexBasis: 0 }]}>{t("pdf.generatedOn", { date: props.generatedAt })}</Text>
      <Text
        style={[end, s.footerText, { flexGrow: 1, flexBasis: 0 }]}
        render={({ pageNumber, totalPages }) => t("pdf.page", { page: pageNumber, total: totalPages })}
      />
    </View>
  );

  const header = (
    <View style={[s.header, row]} fixed>
      <View style={[row, { alignItems: "center", gap: 7 }]}>
        <Mark size={20} />
        <View>
          <Text style={[start, s.headerCompany]}>{props.company.name}</Text>
          {props.company.tagline ? <Text style={[start, s.headerTagline]}>{props.company.tagline}</Text> : null}
        </View>
      </View>
      <Text style={[end, s.headerTitle]}>{props.title}</Text>
      <View style={[s.headerAccent, edge]} />
    </View>
  );

  const metaCard = (label: string, value: string, small?: boolean) => (
    <View key={label} style={[s.card, { width: perRow(3, 6) }]} wrap={false}>
      <Text style={[start, s.cardLabel, latinCaps]}>{label}</Text>
      <Text style={[start, s.cardValue, small ? { fontSize: 9.5 } : {}]}>{value}</Text>
    </View>
  );

  return (
    <Document
      title={props.title}
      author={props.company.name}
      subject={props.subtitle}
      creator="Al-Esnad Pricing"
      producer="Al-Esnad Pricing"
      language={props.locale}
    >
      {props.includeCover ? (
        <Page size="A4" orientation={props.orientation} style={s.coverPage}>
          <View style={[s.band, landscape ? { paddingTop: 28, paddingBottom: 24 } : {}]}>
            <View style={[{ position: "absolute", top: landscape ? -70 : -60 }, farEdge]}>
              <Svg width={landscape ? 250 : 300} height={landscape ? 250 : 300} viewBox="0 0 48 48">
                <Path d={DIAMOND} fill="#1F2026" fillRule="evenodd" />
              </Svg>
            </View>
            <View style={[row, { alignItems: "center", gap: 11 }]}>
              <Mark size={44} />
              <View>
                <Text style={[start, s.coverCompany]}>{props.company.name}</Text>
                {props.company.tagline ? <Text style={[start, s.coverTagline]}>{props.company.tagline}</Text> : null}
              </View>
            </View>
            <View style={{ marginTop: landscape ? 22 : 40 }}>
              <Text style={[start, s.coverTitle, landscape ? { fontSize: 23 } : {}]}>{props.title}</Text>
              <Text style={[start, s.coverSubtitle]}>{props.subtitle}</Text>
              <Text style={[start, s.coverDate]}>{t("pdf.generatedOn", { date: props.generatedAt })}</Text>
            </View>
            {props.confidential ? (
              <View style={row}>
                <Text style={[start, s.badge, landscape ? { maxWidth: 600, marginTop: 10 } : {}]}>
                  {t("pdf.confidential")} — {t("pdf.confidentialNote")}
                </Text>
              </View>
            ) : null}
            <View style={[s.bandAccent, edge]} />
          </View>

          <View style={[s.coverBody, landscape ? { paddingTop: 16 } : {}]}>
            <View style={[s.grid, row]}>
              {metaCard(t("pdf.reportDate"), props.generatedAt, true)}
              {metaCard(t("pdf.totalDevices"), formatNumber(props.totalRecords))}
              {metaCard(t("pdf.brands"), formatNumber(brandCount))}
              {metaCard(t("pdf.scope"), props.scopeLabel, true)}
              {metaCard(t("pdf.preparedBy"), props.generatedBy, true)}
              {metaCard(t("pdf.currency"), props.currency)}
            </View>

            {props.coverStats?.length ? (
              <View wrap={false}>
                <Text style={[start, s.blockTitle, blockGap]}>{t("pdf.summary")}</Text>
                <View style={[s.grid, row]}>
                  {props.coverStats.map((stat) => (
                    <View
                      key={stat.label}
                      wrap={false}
                      style={[
                        s.kpi,
                        { width: perRow(3, 6) },
                        stat.tone === "gold"
                          ? { backgroundColor: C.goldSoft, borderColor: "#EADFC4" }
                          : stat.tone === "success"
                            ? { backgroundColor: C.successSoft, borderColor: "#CDE9DB" }
                            : stat.tone === "brand"
                              ? { backgroundColor: C.brandSoft, borderColor: "#F6CDD2" }
                              : {},
                      ]}
                    >
                      <Text style={[start, s.cardLabel, latinCaps]}>{stat.label}</Text>
                      <Text style={[start, s.kpiValue, { color: toneColor(stat.tone) }]}>{stat.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {brandCount ? (
              <View wrap={false}>
                <Text style={[start, s.blockTitle, blockGap]}>{t("pdf.includedBrands")}</Text>
                <View style={[s.grid, row]}>
                  {sections
                    .filter((x) => x.isBrand !== false)
                    .map((sec) => (
                      <View key={sec.brandName} style={[s.brandTile, row, { width: perRow(3, 4) }]} wrap={false}>
                        <LogoPlate name={sec.brandName} color={sec.brandColor} width={50} height={25} />
                        <View style={{ flexGrow: 1, flexBasis: 0 }}>
                          <Text style={[start, s.brandName]}>{sec.brandName}</Text>
                          <Text style={[start, s.brandCount]}>{sec.countLabel}</Text>
                        </View>
                      </View>
                    ))}
                </View>
              </View>
            ) : null}

            <View wrap={false}>
              <Text style={[start, s.blockTitle, blockGap]}>{t("pdf.appliedFilters")}</Text>
              <View style={[s.grid, row, { gap: 5 }]}>
                {props.filters.length ? (
                  props.filters.map((f) => (
                    <Text key={f} style={[start, s.chip]}>
                      {f}
                    </Text>
                  ))
                ) : (
                  <Text style={[start, s.chip]}>{t("pdf.noFilters")}</Text>
                )}
              </View>
            </View>

            {props.truncated ? <Text style={[start, s.notice]}>{t("pdf.truncated")}</Text> : null}
          </View>
          {footer}
        </Page>
      ) : null}

      <Page size="A4" orientation={props.orientation} style={s.page} wrap>
        {header}
        {footer}
        {sections.length === 0 ? <Text style={[center, { marginTop: 40, color: C.muted }]}>{t("pdf.empty")}</Text> : null}
        {sections.map((section, index) => (
          <View key={section.brandName} style={s.section} break={props.brandPageBreaks && index > 0}>
            <View style={[s.sectionHead, row]} wrap={false} minPresenceAhead={90}>
              <View style={[s.sectionAccent, edge, { backgroundColor: section.brandColor }]} />
              {section.isBrand !== false ? (
                <LogoPlate name={section.brandName} color={section.brandColor} width={68} height={34} />
              ) : null}
              <View style={{ flexGrow: 1, flexBasis: 0 }}>
                <Text style={[start, s.sectionTitle]}>{section.brandName}</Text>
                <Text style={[start, s.sectionMeta]}>{section.countLabel}</Text>
              </View>
              {section.totals?.selling ? (
                <View>
                  <Text style={[end, s.sectionStatLabel]}>{t("pdf.sellingTotal")}</Text>
                  <Text style={[end, s.sectionStatValue]}>
                    {section.totals.selling} {props.currency}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[s.th, row]} fixed>
              {columns.map((col) => (
                <View key={col.key} style={cell(col)}>
                  <Text style={[col.numeric ? end : start, s.thText, latinCaps]}>{col.label}</Text>
                  {col.unit ? <Text style={[col.numeric ? end : start, s.thUnit]}>{col.unit}</Text> : null}
                </View>
              ))}
            </View>

            {section.rows.map((r, i) => (
              <View key={r.id} style={[s.tr, row, i % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
                {columns.map((col, ci) => {
                  const value = r.cells[col.key];
                  return (
                    <View key={col.key} style={cell(col)}>
                      <Text
                        style={[
                          col.numeric ? end : start,
                          s.cellText,
                          { color: toneColor(col.tone), fontWeight: col.bold || ci === 0 ? 600 : 400 },
                        ]}
                      >
                        {value?.text ?? ""}
                      </Text>
                      {value?.sub ? <Text style={[col.numeric ? end : start, s.cellSub]}>{value.sub}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ))}

            {section.totals ? (
              <View style={[s.totalRow, row]} wrap={false}>
                {columns.map((col, i) => (
                  <View key={col.key} style={cell(col)}>
                    <Text style={[col.numeric ? end : start, s.cellText, { fontWeight: 700, color: i === 0 ? C.ink : toneColor(col.tone) }]}>
                      {i === 0 ? t("pdf.subtotal", { brand: section.brandName }) : (section.totals?.[col.key] ?? "")}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {props.grandTotals && sections.length > 1 ? (
          <View wrap={false} style={{ marginTop: 4 }}>
            <View style={[s.grandRow, row]}>
              {columns.map((col, i) => (
                <View key={col.key} style={cell(col)}>
                  <Text style={[col.numeric ? end : start, s.cellText, { color: C.white, fontWeight: 700 }]}>
                    {i === 0 ? t("pdf.grandTotal") : (props.grandTotals?.[col.key] ?? "")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
