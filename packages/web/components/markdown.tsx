"use client";

import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { isSafeHttpUrl } from "@/lib/url";
import { VISUAL_LIMITS, parseChart, type DocumentSource } from "@/lib/visuals";
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
  /** The answer's sources, handed to documents. */
  sources?: readonly DocumentSource[];
  /** Citations link straight to their source instead of opening the sources panel (documents). */
  linkCitations?: boolean;
}

interface RenderContext {
  citations: number;
  allowedLinks: ReadonlySet<string>;
  allowedList?: readonly string[];
  documentKey?: string;
  sources?: readonly DocumentSource[];
  sourceAt?: ReadonlyMap<number, DocumentSource>;
  /** The text is still arriving: an unclosed fence or document may be completed later. */
  streaming: boolean;
  visuals: number;
  documents: number;
}

const VISUAL_LANGUAGES = new Set(["mermaid", "chart"]);

function linkHref(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

/** A fenced block: code, or a chart or diagram once the fence is closed and within the limits. */
function fencedBlock(language: string, code: string, closed: boolean, key: string, ctx: RenderContext): ReactNode {
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

function citation(position: number, key: string, ctx: RenderContext): ReactNode {
  if (ctx.sourceAt) {
    const source = ctx.sourceAt.get(position);
    const href = source && isSafeHttpUrl(source.url) ? linkHref(source.url) : null;
    if (!source || !href) return null;
    return (
      <a key={key} className="citation" href={href} target="_blank" rel="noopener noreferrer" title={source.title} aria-label={`Source ${position}: ${source.title}`}>
        {position}
      </a>
    );
  }
  if (!Number.isInteger(position) || position < 1 || position > ctx.citations) return null;
  return (
    <button key={key} type="button" className="citation" data-citation={position} aria-label={`Show source ${position}`}>
      {position}
    </button>
  );
}

function renderInline(nodes: Inline[], key: string, ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}-${index}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return <code key={k}>{node.value}</code>;
      case "strong":
        return <strong key={k}>{renderInline(node.children, k, ctx)}</strong>;
      case "em":
        return <em key={k}>{renderInline(node.children, k, ctx)}</em>;
      case "del":
        return <del key={k}>{renderInline(node.children, k, ctx)}</del>;
      case "break":
        return <br key={k} />;
      case "link": {
        const href = isSafeHttpUrl(node.href) ? linkHref(node.href) : null;
        const children = renderInline(node.children, k, ctx);
        if (!href || !ctx.allowedLinks.has(href)) return <span key={k}>{children}</span>;
        return (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      case "cite": {
        const parts = node.positions.map((position, n) => citation(position, `${k}-${n}`, ctx));
        // Not a source we know about: keep the text rather than silently dropping it.
        return parts.every(Boolean) ? parts : node.raw;
      }
    }
  });
}

function inline(text: string, key: string, ctx: RenderContext): ReactNode[] {
  return renderInline(parseInline(text), key, ctx);
}

function renderBlocks(blocks: Block[], key: string, ctx: RenderContext): ReactNode[] {
  return blocks.map((block, index) => {
    const k = `${key}-${index}`;
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h2";
        return <Tag key={k}>{inline(block.text, k, ctx)}</Tag>;
      }
      case "paragraph":
        return <p key={k}>{inline(block.text, k, ctx)}</p>;
      case "hr":
        return <hr key={k} />;
      case "code":
        return fencedBlock(block.language, block.code, block.closed, k, ctx);
      case "quote":
        return <blockquote key={k}>{renderBlocks(block.blocks, k, ctx)}</blockquote>;
      case "list": {
        const items = block.items.map((item, n) => (
          <li key={n} className={item.checked === undefined ? undefined : "task-item"}>
            {item.checked === undefined ? null : <input type="checkbox" checked={item.checked} disabled readOnly aria-label={item.checked ? "Done" : "Not done"} />}
            {renderBlocks(item.blocks, `${k}-${n}`, ctx)}
          </li>
        ));
        return block.ordered ? (
          <ol key={k} start={block.start} style={block.start === 1 ? undefined : { counterReset: `step ${block.start - 1}` }}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case "table":
        return (
          <div className="answer-table-wrap" key={k}>
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, n) => (
                    <th key={n} style={{ textAlign: block.align[n] }}>
                      {inline(cell, `${k}-h${n}`, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, n) => (
                      <td key={n} style={{ textAlign: block.align[n] }}>
                        {inline(cell, `${k}-${r}-${n}`, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "document":
        return (
          <DocumentCard
            key={k}
            doc={{
              key: `${ctx.documentKey}:${ctx.documents++}`,
              title: block.title,
              markdown: block.markdown,
              open: !block.closed && ctx.streaming,
              sources: ctx.sources ?? [],
              allowedLinks: ctx.allowedList,
            }}
          />
        );
    }
  });
}

/**
 * Model output as Markdown (see lib/markdown.ts), with [n] citations, ```chart and ```mermaid
 * visuals and, on answers, <document> blocks. Links render only for allowed hrefs.
 */
export const Markdown = memo(function Markdown({
  text,
  citations,
  onCitation,
  streaming,
  allowedLinks,
  documentKey,
  sources,
  linkCitations,
}: MarkdownProps) {
  const allowed = useMemo(
    () => new Set((allowedLinks ?? []).map(linkHref).filter((href): href is string => href !== null)),
    [allowedLinks],
  );
  const tree = useMemo(() => parseMarkdown(text, { documents: !!documentKey }), [text, documentKey]);
  const blocks = useMemo(
    () =>
      renderBlocks(tree, "b", {
        citations: citations ?? sources?.length ?? 0,
        allowedLinks: allowed,
        allowedList: allowedLinks,
        documentKey,
        sources,
        sourceAt: linkCitations ? new Map((sources ?? []).map((source) => [source.position, source])) : undefined,
        streaming: !!streaming,
        visuals: 0,
        documents: 0,
      }),
    [tree, citations, allowed, allowedLinks, documentKey, sources, linkCitations, streaming],
  );

  // Citation clicks are handled by delegation instead of per-button closures.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-citation]");
    if (button) onCitation?.(Number(button.dataset.citation));
  };

  return (
    <div className="answer-prose" onClick={onClick}>
      {blocks}
      {streaming ? <span className="cursor" aria-hidden="true" /> : null}
    </div>
  );
});
