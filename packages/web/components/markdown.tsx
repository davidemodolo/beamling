import type { ReactNode } from "react";

interface MarkdownProps {
  text: string;
  citations?: number;
  onCitation?: (position: number) => void;
  streaming?: boolean;
}

function inline(text: string, key: string, ctx: MarkdownProps): ReactNode[] {
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
      nodes.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={k}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={k}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        const href = link[2];
        if (/^https?:\/\//i.test(href)) {
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
        if (Number.isInteger(position) && position >= 1 && position <= (ctx.citations ?? 0)) {
          nodes.push(
            <button
              key={k}
              type="button"
              className="citation"
              onClick={() => ctx.onCitation?.(position)}
              aria-label={`Show source ${position}`}
            >
              {position}
            </button>,
          );
        }
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** A small, safe markdown subset: headings, lists, quotes, code, bold, italics and [n] citations. */
export function Markdown({ text, citations, onCitation, streaming }: MarkdownProps) {
  const ctx: MarkdownProps = { text, citations, onCitation };
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
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={`k${key++}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`, ctx);
      if (level === 2) blocks.push(<h2 key={`k${key++}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`k${key++}`}>{content}</h3>);
      else blocks.push(<h4 key={`k${key++}`}>{content}</h4>);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
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
            <li key={n}>{inline(item, `u${key}-${n}`, ctx)}</li>
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
            <li key={n}>{inline(item, `o${key}-${n}`, ctx)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) quote.push(lines[i++].slice(2));
      blocks.push(<blockquote key={`k${key++}`}>{inline(quote.join(" "), `q${key}`, ctx)}</blockquote>);
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
      !lines[i].startsWith("> ") &&
      !lines[i].startsWith("```")
    ) {
      paragraph.push(lines[i++]);
    }
    blocks.push(<p key={`k${key++}`}>{inline(paragraph.join(" "), `p${key}`, ctx)}</p>);
  }

  return (
    <div className="answer-prose">
      {blocks}
      {streaming ? <span className="cursor" aria-hidden="true" /> : null}
    </div>
  );
}
