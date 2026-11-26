"use client";

import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { isSafeHttpUrl } from "@/lib/url";
import { VISUAL_LIMITS, parseChart, type DocumentSource } from "@/lib/visuals";
import { AnswerImage } from "./visuals/answer-image";
import { ChartBlock } from "./visuals/chart-block";
import { CodeBlock } from "./visuals/code-block";
import { DocumentCard } from "./visuals/document";
import { MermaidBlock } from "./visuals/mermaid-block";
import { VisualBoundary, VisualError } from "./visuals/visual-error";

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
  /** Sources by position, for pictures. */
  imageAt: ReadonlyMap<number, DocumentSource>;
  /** The text is still arriving: an unclosed fence or document may be completed later. */
  streaming: boolean;
  visuals: number;
  images: number;
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
    return <VisualError key={key} code={code} language={language} detail="Too large to draw." />;
  }
  if (language === "chart") {
    const spec = parseChart(code);
    if (!spec) return <VisualError key={key} code={code} language="json" detail="The chart could not be drawn." />;
    ctx.visuals++;
    return (
      <VisualBoundary key={key} code={code} language="json">
        <ChartBlock spec={spec} />
      </VisualBoundary>
    );
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

/**
 * A source's picture. Its caption alone when the source has no picture or the answer already shows
 * VISUAL_LIMITS.imagesPerAnswer; a placeholder while streaming, since the route serves stored sources only.
 */
function answerImage(alt: string, position: number, key: string, ctx: RenderContext): ReactNode {
  const source = ctx.imageAt.get(position);
  if (!source?.hasImage || !source.id || ctx.images >= VISUAL_LIMITS.imagesPerAnswer) return alt;
  ctx.images++;
  if (ctx.streaming) {
    return (
      <span key={key} className="answer-image answer-image-pending">
        Loading picture…
      </span>
    );
  }
  return (
    <AnswerImage
      key={key}
      sourceId={source.id}
      caption={alt}
      sourceTitle={source.title}
      sourceUrl={source.url}
      cite={citation(position, `${key}-c`, ctx)}
    />
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
      case "image":
        return answerImage(node.alt, node.position, k, ctx);
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
      case "paragraph": {
        const nodes = parseInline(block.text);
        // A paragraph of pictures only is laid out as a block, not as a line of text.
        const pictures = nodes.some((node) => node.type === "image") && nodes.every((node) => node.type === "image" || node.type === "break" || (node.type === "text" && !node.value.trim()));
        return pictures ? (
          <div key={k} className="answer-images">
            {renderInline(nodes, k, ctx)}
          </div>
        ) : (
          <p key={k}>{renderInline(nodes, k, ctx)}</p>
        );
      }
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
        imageAt: new Map((sources ?? []).map((source) => [source.position, source])),
        visuals: 0,
        images: 0,
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
