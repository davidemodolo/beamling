"use client";

import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { isSafeHttpUrl } from "@/lib/url";
import { DOCUMENT_CLOSE, DOCUMENT_OPEN, VISUAL_LIMITS, documentTitle, fenceLanguage, parseChart } from "@/lib/visuals";
import { ChartBlock } from "./visuals/chart-block";
import { CodeBlock } from "./visuals/code-block";
import { DocumentCard } from "./visuals/document";
import { MermaidBlock } from "./visuals/mermaid-block";

interface MarkdownProps {
  text: string;
  citations?: number;
  onCitation?: (position: number) => void;
  streaming?: boolean;
  /** When set, only these exact hrefs are rendered as links. Model output is otherwise plain text. */
  allowedLinks?: readonly string[];
  /** Set on answers: a <document> block becomes a card that opens the document panel. Keys the document. */
  documentKey?: string;
}

interface ParseContext {
  citations: number;
  allowedLinks: ReadonlySet<string>;
  allowedList?: readonly string[];
  documentKey?: string;
  onCitation?: (position: number) => void;
  /** The text is still arriving: an unclosed fence or document may be completed later. */
  streaming: boolean;
  visuals: number;
  documents: number;
}

const VISUAL_LANGUAGES = new Set(["mermaid", "chart"]);

/** A fenced block: code, or a chart or diagram once the fence is closed and within the limits. */
function fencedBlock(language: string, code: string, closed: boolean, key: string, ctx: ParseContext): ReactNode {
  if (!VISUAL_LANGUAGES.has(language) || (!closed && !ctx.streaming)) return <CodeBlock key={key} code={code} language={language} closed={closed || !ctx.streaming} />;
  if (!closed) {
    return (
      <div key={key} className="visual visual-pending">
        Drawing…
      </div>
    );
  }
  if (ctx.visuals >= VISUAL_LIMITS.perAnswer || code.length > VISUAL_LIMITS.blockChars) {
    return <CodeBlock key={key} code={code} language={language} note="Too large to draw" />;
  }
  if (language === "chart") {
    const spec = parseChart(code);
    if (!spec) return <CodeBlock key={key} code={code} language="json" note="Could not draw this chart" />;
    ctx.visuals++;
    return <ChartBlock key={key} spec={spec} />;
  }
  ctx.visuals++;
  return <MermaidBlock key={key} source={code} />;
}

const HR = /^---+$/;

function linkHref(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function inline(text: string, key: string, citations: number, allowedLinks: ReadonlySet<string>): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\)|\[\d+\])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={k}>{inline(token.slice(2, -2), k, citations, allowedLinks)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={k}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={k}>{inline(token.slice(1, -1), k, citations, allowedLinks)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        const href = isSafeHttpUrl(link[2]) ? linkHref(link[2]) : null;
        if (href && allowedLinks.has(href)) {
          nodes.push(
            <a key={k} href={href} target="_blank" rel="noopener noreferrer">
              {link[1]}
            </a>,
          );
        } else {
          nodes.push(link[1]);
        }
      } else {
        const position = Number(token.slice(1, -1));
        if (Number.isInteger(position) && position >= 1 && position <= citations) {
          nodes.push(
            <button key={k} type="button" className="citation" data-citation={position} aria-label={`Show source ${position}`}>
              {position}
            </button>,
          );
        } else {
          // Not a source we know about: keep the text rather than silently dropping it.
          nodes.push(token);
        }
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}


function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char === "|" ? "|" : `\\${char}`;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function tableAlignments(line: string): ("left" | "center" | "right")[] | null {
  const cells = tableCells(line);
  if (!cells.length || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left",
  );
}

function tableBlock(lines: string[], start: number, key: number, citations: number, allowedLinks: ReadonlySet<string>): { node: ReactNode; next: number } | null {
  const header = tableCells(lines[start]);
  const alignments = tableAlignments(lines[start + 1] ?? "");
  if (!alignments || header.length !== alignments.length) return null;
  const body: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    const row = tableCells(lines[i]);
    if (row.length !== header.length) break;
    body.push(row);
    i++;
  }
  const align = (index: number) => ({ textAlign: alignments[index] });
  const node = (
    <div className="answer-table-wrap" key={`k${key}`}>
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} style={align(index)}>{inline(cell, `th${key}-${index}`, citations, allowedLinks)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index} style={align(index)}>{inline(cell, `td${key}-${rowIndex}-${index}`, citations, allowedLinks)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return { node, next: i };
}

function parse(text: string, ctx: ParseContext): ReactNode[] {
  const { citations, allowedLinks } = ctx;
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const language = fenceLanguage(line);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      const closed = i < lines.length;
      i++;
      blocks.push(fencedBlock(language, code.join("\n"), closed, `k${key++}`, ctx));
      continue;
    }

    const opening = ctx.documentKey ? DOCUMENT_OPEN.exec(line.trim()) : null;
    if (opening) {
      const body: string[] = [];
      let fenced = false;
      i++;
      while (i < lines.length && (fenced || !DOCUMENT_CLOSE.test(lines[i].trim()))) {
        if (lines[i].startsWith("```")) fenced = !fenced;
        body.push(lines[i++]);
      }
      const open = i >= lines.length && ctx.streaming;
      i++;
      blocks.push(
        <DocumentCard
          key={`k${key++}`}
          doc={{
            key: `${ctx.documentKey}:${ctx.documents++}`,
            title: documentTitle(opening[1]),
            markdown: body.join("\n"),
            open,
            citations,
            allowedLinks: ctx.allowedList,
            onCitation: ctx.onCitation,
          }}
        />,
      );
      continue;
    }

    if (line.includes("|")) {
      const table = tableBlock(lines, i, key, citations, allowedLinks);
      if (table) {
        key++;
        blocks.push(table.node);
        i = table.next;
        continue;
      }
    }

    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`, citations, allowedLinks);
      if (level === 2) blocks.push(<h2 key={`k${key++}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`k${key++}`}>{content}</h3>);
      else blocks.push(<h4 key={`k${key++}`}>{content}</h4>);
      i++;
      continue;
    }

    if (HR.test(line.trim())) {
      blocks.push(<hr key={`k${key++}`} />);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ""));
      blocks.push(
        <ul key={`k${key++}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `u${key}-${n}`, citations, allowedLinks)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s+/, ""));
      blocks.push(
        <ol key={`k${key++}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `o${key}-${n}`, citations, allowedLinks)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) quote.push(lines[i++].slice(2));
      blocks.push(<blockquote key={`k${key++}`}>{inline(quote.join(" "), `q${key}`, citations, allowedLinks)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,4})\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !HR.test(lines[i].trim()) &&
      !lines[i].startsWith("> ") &&
      !lines[i].startsWith("```") &&
      !DOCUMENT_OPEN.test(lines[i].trim())
    ) {
      paragraph.push(lines[i++]);
    }
    blocks.push(<p key={`k${key++}`}>{inline(paragraph.join(" "), `p${key}`, citations, allowedLinks)}</p>);
  }

  return blocks;
}

/**
 * A small, safe markdown subset: headings, lists, quotes, code, bold, italics and [n] citations,
 * plus ```chart and ```mermaid visuals and, on answers, <document> blocks.
 */
export const Markdown = memo(function Markdown({
  text,
  citations = 0,
  onCitation,
  streaming,
  allowedLinks,
  documentKey,
}: MarkdownProps) {
  // The parse only depends on the text, so citation clicks are handled by delegation instead of per-button closures.
  const allowed = useMemo(
    () => new Set((allowedLinks ?? []).map(linkHref).filter((href): href is string => href !== null)),
    [allowedLinks],
  );
  const blocks = useMemo(
    () => parse(text, { citations, allowedLinks: allowed, allowedList: allowedLinks, documentKey, onCitation: documentKey ? onCitation : undefined, streaming: !!streaming, visuals: 0, documents: 0 }),
    // onCitation only reaches documents, which are keyed: other blocks use the click delegation below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, citations, allowed, documentKey, documentKey ? onCitation : null, !!streaming],
  );

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-citation]");
    if (button) onCitation?.(Number(button.dataset.citation));
  };

  return (
    <div className="answer-prose" onClick={onClick}>
      {blocks}
      {streaming ? <span className="cursor" aria-hidden="true" /> : null}
    </div>
  );
});
