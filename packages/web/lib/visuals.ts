import { z } from "zod";

/** Limits on what an answer can draw. Over a limit, the block is shown as plain code. */
export const VISUAL_LIMITS = {
  /** Characters of one chart or diagram block. */
  blockChars: 20_000,
  /** Charts and diagrams drawn per answer; later ones are shown as code. */
  perAnswer: 4,
  chartRows: 200,
  chartSeries: 6,
} as const;

/** The block language from an opening fence line such as "```ts title" ("" when none). */
export function fenceLanguage(line: string): string {
  const info = line.replace(/^`{3,}/, "").trim().split(/\s+/)[0] ?? "";
  return info.toLowerCase().replace(/[^a-z0-9#+-]/g, "").slice(0, 20);
}

const cell = z.union([z.string().max(200), z.number().finite()]);

const chartSchema = z
  .object({
    type: z.enum(["bar", "line", "pie"]),
    title: z.string().max(120).optional(),
    x: z.string().min(1).max(60),
    series: z
      .array(z.object({ key: z.string().min(1).max(60), label: z.string().max(60).optional() }).strict())
      .min(1)
      .max(VISUAL_LIMITS.chartSeries),
    data: z.array(z.record(z.string().max(60), cell)).min(1).max(VISUAL_LIMITS.chartRows),
    unit: z.string().max(12).optional(),
  })
  .strict();

export type ChartSpec = z.infer<typeof chartSchema>;

/**
 * Reads a ```chart block. Every series value must be a number in every row; pie charts take one
 * series and non-negative values. Anything else is refused and the block is shown as code.
 */
export function parseChart(source: string): ChartSpec | null {
  if (source.length > VISUAL_LIMITS.blockChars) return null;
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return null;
  }
  const parsed = chartSchema.safeParse(json);
  if (!parsed.success) return null;
  const spec = parsed.data;
  if (spec.type === "pie" && spec.series.length !== 1) return null;
  for (const row of spec.data) {
    if (row[spec.x] === undefined) return null;
    for (const series of spec.series) {
      const value = row[series.key];
      if (typeof value !== "number") return null;
      if (spec.type === "pie" && value < 0) return null;
    }
  }
  return spec;
}

/** A document the answer wrapped in <document title="...">...</document>. */
export interface AnswerDocument {
  title: string;
  markdown: string;
  /** The closing tag has not arrived yet. */
  open: boolean;
}

export const DOCUMENT_OPEN = /^<document(?:\s+title="([^"]{0,120})")?\s*>\s*$/;
export const DOCUMENT_CLOSE = /^<\/document>\s*$/;

/** Plain title for a document, with a fallback. */
export function documentTitle(raw: string | undefined): string {
  const title = (raw ?? "").replace(/\s+/g, " ").trim();
  return title || "Document";
}

/** File name for downloading a document as Markdown. */
export function documentFileName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "document"}.md`;
}

/** A source a document can cite, by its answer position. */
export interface DocumentSource {
  position: number;
  title: string;
  url: string;
}

/** The document text without a first "# heading" that only repeats its title. */
export function documentBody(title: string, markdown: string): string {
  const lines = markdown.replace(/^\s*\n/, "").split("\n");
  const first = /^ {0,3}#\s+(.*?)\s*#*\s*$/.exec(lines[0] ?? "");
  const same = (value: string) => value.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (first && same(first[1]) === same(title)) lines.shift();
  return lines.join("\n").trim();
}

/** Source positions cited in a document, outside code, in order of position. */
export function citedPositions(markdown: string, sources: readonly DocumentSource[]): DocumentSource[] {
  const prose = markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, "").replace(/`[^`\n]+`/g, "");
  const cited = new Set<number>();
  for (const match of prose.matchAll(/\[\^?(\d{1,3}(?:\s*[,;]\s*\^?\d{1,3})*)\](?!\()/g)) {
    for (const value of match[1].split(/[,;]/)) cited.add(Number(value.replace(/[\s^]/g, "")));
  }
  return sources.filter((source) => cited.has(source.position)).sort((a, b) => a.position - b.position);
}

/**
 * The document as a standalone Markdown file: title, text and the cited sources. Reference
 * definitions keep each [n] in the text a working link in any Markdown viewer.
 */
export function documentMarkdown(doc: { title: string; markdown: string }, sources: readonly DocumentSource[]): string {
  const body = documentBody(doc.title, doc.markdown);
  const cited = citedPositions(body, sources);
  const parts = [`# ${doc.title}`, body];
  if (cited.length) {
    const label = (value: string) => value.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim() || "Source";
    parts.push(
      `## Sources\n\n${cited.map((source) => `- [${source.position}] [${label(source.title)}](<${source.url}>)`).join("\n")}`,
      cited.map((source) => `[${source.position}]: <${source.url}> "${label(source.title).replace(/"/g, "'")}"`).join("\n"),
    );
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}
