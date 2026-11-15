import { DOCUMENT_CLOSE, DOCUMENT_OPEN, documentTitle, fenceLanguage } from "./visuals";

/**
 * A Markdown parser for model output: CommonMark blocks and GFM tables, task lists and
 * strikethrough, plus [n] citations and <document> blocks. No raw HTML: the result is a tree the
 * renderer turns into React elements, so nothing from the model is ever inserted as markup.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "cite"; positions: number[]; raw: string }
  | { type: "break" };

export type Align = "left" | "center" | "right";

export interface ListItem {
  /** Set on task list items ("- [ ]" and "- [x]"). */
  checked?: boolean;
  blocks: Block[];
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "hr" }
  | { type: "code"; language: string; code: string; closed: boolean }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { type: "document"; title: string; markdown: string; closed: boolean };

export interface ParseOptions {
  /** Read top-level <document> blocks (answers only). */
  documents?: boolean;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])( +)(\S.*)$/;
const TASK = /^\[([ xX])\][ \t]+/;

function leading(line: string): number {
  return line.length - line.trimStart().length;
}

function fenceCloses(line: string, marker: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!match && match[1][0] === marker[0] && match[1].length >= marker.length;
}

export function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
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

function tableAlign(line: string | undefined): Align[] | null {
  if (!line || !line.includes("-")) return null;
  const cells = tableCells(line);
  if (!cells.length || !cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"));
}

function isTableStart(line: string, next: string | undefined): boolean {
  if (!line.includes("|")) return false;
  const align = tableAlign(next);
  return !!align && align.length === tableCells(line).length;
}

function startsBlock(line: string, next: string | undefined, options: ParseOptions): boolean {
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    LIST.test(line) ||
    QUOTE.test(line) ||
    (!!options.documents && DOCUMENT_OPEN.test(line.trim())) ||
    isTableStart(line, next)
  );
}

function parseBlocks(lines: string[], options: ParseOptions): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const indent = leading(line);
      const code: string[] = [];
      i++;
      while (i < lines.length && !fenceCloses(lines[i], fence[1])) {
        const text = lines[i++];
        code.push(text.slice(Math.min(indent, leading(text))));
      }
      const closed = i < lines.length;
      i++;
      blocks.push({ type: "code", language: fenceLanguage(`\`\`\`${fence[2]}`), code: code.join("\n"), closed });
      continue;
    }

    const opening = options.documents ? DOCUMENT_OPEN.exec(line.trim()) : null;
    if (opening) {
      const body: string[] = [];
      let marker: string | null = null;
      i++;
      while (i < lines.length && (marker || !DOCUMENT_CLOSE.test(lines[i].trim()))) {
        const text = lines[i++];
        if (marker) {
          if (fenceCloses(text, marker)) marker = null;
        } else {
          marker = FENCE_OPEN.exec(text)?.[1] ?? null;
        }
        body.push(text);
      }
      const closed = i < lines.length;
      i++;
      blocks.push({ type: "document", title: documentTitle(opening[1]), markdown: body.join("\n"), closed });
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const header = tableCells(line);
      const align = tableAlign(lines[i + 1])!;
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !FENCE_OPEN.test(lines[i]) && !HEADING.test(lines[i])) {
        const cells = tableCells(lines[i++]);
        rows.push(header.map((_, index) => cells[index] ?? ""));
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = (heading[2] ?? "").trim();
      if (text) blocks.push({ type: "heading", level: heading[1].length as 1, text });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (LIST.test(line)) {
      i = parseList(lines, i, options, blocks);
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const quote = QUOTE.exec(lines[i]);
        if (quote) {
          body.push(quote[1]);
        } else if (lines[i].trim() && body.at(-1)?.trim() && !startsBlock(lines[i], lines[i + 1], options)) {
          // A lazy continuation line of the quoted paragraph.
          body.push(lines[i].trim());
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body, { ...options, documents: false }) });
      continue;
    }

    // A paragraph: soft line breaks become spaces, a trailing backslash or two spaces a hard break.
    let text = line.trim();
    let hard = /( {2,}|\\)$/.test(line);
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1], options)) {
      if (SETEXT_H1.test(lines[i])) break;
      text = `${text.replace(/\\$/, "")}${hard ? "\n" : " "}${lines[i].trim()}`;
      hard = /( {2,}|\\)$/.test(lines[i]);
      i++;
    }
    if (i < lines.length && SETEXT_H1.test(lines[i])) {
      blocks.push({ type: "heading", level: 1, text });
      i++;
      continue;
    }
    blocks.push({ type: "paragraph", text });
  }

  return blocks;
}

/** A list from line `start`; nested lists and other blocks belong to an item when indented under it. */
function parseList(lines: string[], start: number, options: ParseOptions, blocks: Block[]): number {
  const first = LIST.exec(lines[start])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const match = LIST.exec(lines[i]);
    // Siblings sit at the list's indentation; models are not exact, so one space either way is fine.
    if (!match || match[1].length >= base + 2 || /\d/.test(match[2]) !== ordered) break;
    const contentIndent = match[1].length + match[2].length + Math.min(match[3].length, 4);
    const body = [match[4]];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && leading(lines[next]) >= base + 2) {
          while (i < next) {
            body.push("");
            i++;
          }
          continue;
        }
        // A blank line between items keeps the list going; anything else ends it.
        const sibling = next < lines.length ? LIST.exec(lines[next]) : null;
        if (sibling && sibling[1].length < base + 2 && /\d/.test(sibling[2]) === ordered) i = next;
        break;
      }
      const indent = leading(line);
      if (indent >= base + 2) {
        body.push(line.slice(Math.min(indent, contentIndent)));
        i++;
        continue;
      }
      if (LIST.test(line)) break;
      if (body.at(-1)?.trim() && !startsBlock(line, lines[i + 1], options)) {
        body.push(line.trim());
        i++;
        continue;
      }
      break;
    }
    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({ checked: task ? task[1] !== " " : undefined, blocks: parseBlocks(body, { ...options, documents: false }) });
  }

  blocks.push({ type: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items });
  return i;
}

export function parseMarkdown(text: string, options: ParseOptions = {}): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), options);
}

const WORD = String.raw`[\p{L}\p{N}_]`;
const INLINE = new RegExp(
  [
    String.raw`\\(?<esc>[!-/:-@[-\x60{-~])`,
    String.raw`\x60(?<code>[^\x60\n]+)\x60`,
    String.raw`\*\*\*(?<strongEm>\S(?:[\s\S]*?\S)?)\*\*\*`,
    String.raw`\*\*(?<strong>\S(?:[\s\S]*?\S)?)\*\*`,
    String.raw`(?<!${WORD})__(?<strong2>\S(?:[\s\S]*?\S)?)__(?!${WORD})`,
    String.raw`~~(?<del>\S(?:[\s\S]*?\S)?)~~`,
    String.raw`\*(?<em>[^\s*](?:[^*]*[^\s*])?)\*`,
    String.raw`(?<!${WORD})_(?<em2>[^\s_](?:[^_]*[^\s_])?)_(?!${WORD})`,
    String.raw`\[(?<linkText>(?:[^[\]]|\[[^[\]]*\])+)\]\(\s*<?(?<linkHref>[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+"[^"]*")?\s*\)`,
    String.raw`<(?<auto>https?:\/\/[^\s<>]+)>`,
    String.raw`\[\^?(?<cite>\d{1,3}(?:\s*[,;]\s*\^?\d{1,3})*)\]`,
    String.raw`(?<br>\n)`,
  ].join("|"),
  "gu",
);

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  const pushText = (value: string) => {
    const last = nodes.at(-1);
    if (last?.type === "text") last.value += value;
    else if (value) nodes.push({ type: "text", value });
  };
  const pattern = new RegExp(INLINE.source, INLINE.flags);
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    pushText(text.slice(last, match.index));
    last = pattern.lastIndex;
    const g = match.groups!;
    if (g.esc !== undefined) pushText(g.esc);
    else if (g.code !== undefined) nodes.push({ type: "code", value: g.code });
    else if (g.strongEm !== undefined) nodes.push({ type: "strong", children: [{ type: "em", children: parseInline(g.strongEm) }] });
    else if (g.strong !== undefined || g.strong2 !== undefined) nodes.push({ type: "strong", children: parseInline(g.strong ?? g.strong2) });
    else if (g.del !== undefined) nodes.push({ type: "del", children: parseInline(g.del) });
    else if (g.em !== undefined || g.em2 !== undefined) nodes.push({ type: "em", children: parseInline(g.em ?? g.em2) });
    else if (g.linkText !== undefined) nodes.push({ type: "link", href: g.linkHref, children: parseInline(g.linkText) });
    else if (g.auto !== undefined) nodes.push({ type: "link", href: g.auto, children: [{ type: "text", value: g.auto }] });
    else if (g.cite !== undefined) nodes.push({ type: "cite", positions: g.cite.split(/[,;]/).map((n) => Number(n.replace(/[\s^]/g, ""))), raw: match[0] });
    else nodes.push({ type: "break" });
  }
  pushText(text.slice(last));
  return nodes;
}
