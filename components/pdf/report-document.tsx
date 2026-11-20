import path from "node:path";
import { Circle, Document, Font, Page, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

/*
 * Corporate PDF report (server-side only). Typography: IBM Plex Sans Arabic
 * (Arabic + Latin, OFL) so the Arabic company name renders correctly.
 * Columns are chosen per report variant; the data passed in has already been
 * restricted to what the requesting role may see.
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
  charcoal: "#23262C",
  ink: "#1B1B1F",
  muted: "#63636B",
  line: "#E5E5E8",
  soft: "#F5F5F6",
  zebra: "#FAFAFB",
  gold: "#8F6714",
  success: "#187C54",
};

const s = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 8.6, color: C.ink, paddingTop: 54, paddingBottom: 54, paddingHorizontal: 36 },
  header: { position: "absolute", top: 18, left: 36, right: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, borderBottomWidth: 0.6, borderBottomColor: C.line },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: 8, color: C.muted },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.2, color: C.muted, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 7 },
  confidential: { color: C.brand, fontWeight: 600 },
  // cover
  coverBand: { backgroundColor: "#1B1C20", marginHorizontal: -36, marginTop: -54, paddingHorizontal: 36, paddingTop: 34, paddingBottom: 28, color: "#FFFFFF" },
  coverCompany: { fontSize: 13, fontWeight: 600, marginTop: 14 },
  coverTagline: { fontSize: 8.5, color: "#B9B9C2", marginTop: 2, letterSpacing: 1 },
  coverTitle: { fontSize: 24, fontWeight: 700, marginTop: 24, lineHeight: 1.2 },
  coverSubtitle: { fontSize: 11, color: "#FF8A95", marginTop: 6, fontWeight: 500 },
  coverConfidential: { fontSize: 7.5, color: "#FFFFFF", backgroundColor: "#DB1829", alignSelf: "flex-start", borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, marginTop: 12 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 20, gap: 8 },
  metaCard: { width: "31.8%", borderWidth: 0.6, borderColor: C.line, borderRadius: 6, padding: 9 },
  metaLabel: { fontSize: 7, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  metaValue: { fontSize: 11, fontWeight: 600, marginTop: 3 },
  sectionLabel: { fontSize: 9, fontWeight: 600, marginTop: 16, marginBottom: 6, color: C.charcoal },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { fontSize: 7.6, backgroundColor: C.soft, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 7, color: C.charcoal },
  brandList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  brandPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 0.6, borderColor: C.line, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // sections
  section: { marginBottom: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, marginBottom: 6 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#FFFFFF" },
  sectionMeta: { fontSize: 8, color: "#FFFFFF", opacity: 0.9 },
  th: { flexDirection: "row", backgroundColor: C.charcoal, color: "#FFFFFF", borderRadius: 3, paddingVertical: 6, paddingHorizontal: 6, fontSize: 7.4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  tr: { flexDirection: "row", paddingVertical: 5.5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.line, alignItems: "center" },
  totalRow: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 6, backgroundColor: C.soft, borderRadius: 3, marginTop: 3, fontWeight: 700 },
  cellEnd: { textAlign: "right" },
  small: { fontSize: 6.8, color: C.muted, marginTop: 1 },
  notice: { marginTop: 16, padding: 9, borderRadius: 6, backgroundColor: "#FDECEE", color: "#9F1220", fontSize: 8 },
});

export type ReportColumn = {
  key: string;
  label: string;
  width: number; // flex basis (relative)
  align?: "left" | "right";
  tone?: "brand" | "gold" | "success" | "muted";
  bold?: boolean;
  total?: boolean;
};

export type ReportCell = { text: string; sub?: string };
export type ReportRow = { id: string; cells: Record<string, ReportCell> };
export type ReportSection = {
  brandName: string;
  brandColor: string;
  rows: ReportRow[];
  totals?: Record<string, string>;
  countLabel: string;
};

export type ReportDocumentProps = {
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
  coverStats?: Array<{ label: string; value: string }>;
  orientation: "portrait" | "landscape";
  includeCover: boolean;
  brandPageBreaks: boolean;
  confidential: boolean;
  truncated: boolean;
  currency: string;
};

function Mark({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Rect width="48" height="48" rx="10.5" fill="#333333" />
      <Path
        transform="translate(6.72 6.72) scale(0.72)"
        d="M24 0 L48 24 L24 48 L0 24 Z M20.808 15.876 L22.769 17.836 L32.302 8.302 L30.342 6.342 Z M30.164 25.232 L32.124 27.192 L41.658 17.658 L39.698 15.698 Z"
        fill="#FFFFFF"
        fillRule="evenodd"
      />
      <Circle cx="21.6" cy="26.4" r="4.63" fill="#E11D2E" />
    </Svg>
  );
}

function toneColor(tone?: ReportColumn["tone"]) {
  return tone === "brand" ? C.brand : tone === "gold" ? C.gold : tone === "success" ? C.success : tone === "muted" ? C.muted : C.ink;
}

function Cell({ col, children }: { col: ReportColumn; children: ReactNode }) {
  return (
    <View style={{ flexGrow: col.width, flexBasis: 0, paddingRight: 6 }}>
      <Text style={[col.align === "right" ? s.cellEnd : {}, { color: toneColor(col.tone), fontWeight: col.bold ? 600 : 400 }]}>
        {children}
      </Text>
    </View>
  );
}

function TableHeader({ columns }: { columns: ReportColumn[] }) {
  return (
    <View style={s.th} fixed>
      {columns.map((col) => (
        <View key={col.key} style={{ flexGrow: col.width, flexBasis: 0, paddingRight: 6 }}>
          <Text style={col.align === "right" ? s.cellEnd : {}}>{col.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ReportDocument(props: ReportDocumentProps) {
  registerFonts();
  const { columns, sections } = props;

  const landscape = props.orientation === "landscape";
  const card = [s.metaCard, landscape ? { width: "23.9%", padding: 7 } : { width: "31.8%" }];
  const cardValue = landscape ? { fontSize: 10 } : {};
  const band = landscape ? { paddingTop: 24, paddingBottom: 20 } : {};
  const titleSize = landscape ? { fontSize: 20, marginTop: 16 } : {};
  const footer = (
    <View style={s.footer} fixed>
      <Text>
        {props.confidential ? <Text style={s.confidential}>CONFIDENTIAL · </Text> : null}
        {props.company.footer ?? `${props.company.name} — internal document`}
      </Text>
      <Text>Generated {props.generatedAt}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
  const chrome = (
    <>
      <View style={s.header} fixed>
        <View style={s.headerBrand}>
          <Mark size={14} />
          <Text style={{ fontSize: 8, fontWeight: 600 }}>{props.company.name}</Text>
        </View>
        <Text style={s.headerTitle}>{props.title}</Text>
      </View>
      {footer}
    </>
  );

  return (
    <Document
      title={props.title}
      author={props.company.name}
      subject={props.subtitle}
      creator="Al-Esnad Pricing"
      producer="Al-Esnad Pricing"
      language="en"
    >
      {props.includeCover ? (
        <Page size="A4" orientation={props.orientation} style={s.page}>
          <View style={[s.coverBand, band]}>
            <Mark size={40} />
            <Text style={s.coverCompany}>{props.company.name}</Text>
            {props.company.tagline ? <Text style={s.coverTagline}>{props.company.tagline.toUpperCase()}</Text> : null}
            <Text style={[s.coverTitle, titleSize]}>{props.title}</Text>
            <Text style={s.coverSubtitle}>{props.subtitle}</Text>
            {props.confidential ? (
              <Text style={s.coverConfidential}>
                CONFIDENTIAL — contains private purchase prices, supplier benefits and company profit. Authorised management use only.
              </Text>
            ) : null}
          </View>

          <View style={s.metaGrid}>
            <View style={card}>
              <Text style={s.metaLabel}>Generated</Text>
              <Text style={[s.metaValue, cardValue]}>{props.generatedAt}</Text>
            </View>
            <View style={card}>
              <Text style={s.metaLabel}>Total devices</Text>
              <Text style={[s.metaValue, cardValue]}>{props.totalRecords.toLocaleString("en-US")}</Text>
            </View>
            <View style={card}>
              <Text style={s.metaLabel}>Brands</Text>
              <Text style={[s.metaValue, cardValue]}>{sections.length}</Text>
            </View>
            <View style={card}>
              <Text style={s.metaLabel}>Scope</Text>
              <Text style={[s.metaValue, cardValue, { fontSize: 9.5 }]}>{props.scopeLabel}</Text>
            </View>
            <View style={card}>
              <Text style={s.metaLabel}>Prepared by</Text>
              <Text style={[s.metaValue, cardValue, { fontSize: 9.5 }]}>{props.generatedBy}</Text>
            </View>
            <View style={card}>
              <Text style={s.metaLabel}>Currency</Text>
              <Text style={[s.metaValue, cardValue]}>{props.currency}</Text>
            </View>
            {props.coverStats?.map((stat) => (
              <View key={stat.label} style={card}>
                <Text style={s.metaLabel}>{stat.label}</Text>
                <Text style={[s.metaValue, cardValue]}>{stat.value}</Text>
              </View>
            ))}
          </View>

          <Text style={s.sectionLabel}>Applied filters</Text>
          <View style={s.chipRow}>
            {props.filters.length ? (
              props.filters.map((f) => (
                <Text key={f} style={s.chip}>
                  {f}
                </Text>
              ))
            ) : (
              <Text style={s.chip}>None — complete selection</Text>
            )}
          </View>

          <Text style={s.sectionLabel}>Included brands</Text>
          <View style={s.brandList}>
            {sections.map((sec) => (
              <View key={sec.brandName} style={s.brandPill} wrap={false}>
                <View style={[s.dot, { backgroundColor: sec.brandColor }]} />
                <Text style={{ fontWeight: 600 }}>{sec.brandName}</Text>
                <Text style={{ color: C.muted }}>{sec.countLabel}</Text>
              </View>
            ))}
          </View>

          {props.truncated ? (
            <Text style={s.notice}>
              This report reached the maximum of 10,000 devices and is truncated. Narrow the filters to include every record.
            </Text>
          ) : null}
          {footer}
        </Page>
      ) : null}

      <Page size="A4" orientation={props.orientation} style={s.page} wrap>
        {chrome}
        {sections.length === 0 ? (
          <Text style={{ marginTop: 40, textAlign: "center", color: C.muted }}>No devices match this report’s scope.</Text>
        ) : null}
        {sections.map((section, index) => (
          <View key={section.brandName} style={s.section} break={props.brandPageBreaks && index > 0}>
            <View style={[s.sectionHead, { backgroundColor: section.brandColor }]} wrap={false}>
              <Text style={s.sectionTitle}>{section.brandName}</Text>
              <Text style={s.sectionMeta}>{section.countLabel}</Text>
            </View>
            <TableHeader columns={columns} />
            {section.rows.map((row, i) => (
              <View key={row.id} style={[s.tr, i % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
                {columns.map((col) => (
                  <Cell key={col.key} col={col}>
                    {row.cells[col.key]?.text ?? ""}
                    {row.cells[col.key]?.sub ? `\n${row.cells[col.key].sub}` : ""}
                  </Cell>
                ))}
              </View>
            ))}
            {section.totals ? (
              <View style={s.totalRow} wrap={false}>
                {columns.map((col, i) => (
                  <Cell key={col.key} col={{ ...col, bold: true }}>
                    {i === 0 ? `${section.brandName} subtotal` : (section.totals?.[col.key] ?? "")}
                  </Cell>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {props.grandTotals && sections.length > 1 ? (
          <View wrap={false} style={{ marginTop: 6 }}>
            <View style={[s.totalRow, { backgroundColor: C.charcoal }]}>
              {columns.map((col, i) => (
                <View key={col.key} style={{ flexGrow: col.width, flexBasis: 0, paddingRight: 6 }}>
                  <Text style={[col.align === "right" ? s.cellEnd : {}, { color: "#FFFFFF", fontWeight: 700 }]}>
                    {i === 0 ? "Grand total — all brands" : (props.grandTotals?.[col.key] ?? "")}
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
