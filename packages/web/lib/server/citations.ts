const CITATION_RE = /\[(\d{1,2})\]/g;

function protectedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const patterns = [
    /```[\s\S]*?```/g,
    /~~~[\s\S]*?~~~/g,
    /`[^`\n]*`/g,
    /https?:\/\/[^\s)<>\]]+/g,
    /\]\([^)]+\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function isProtected(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

export function stripCitations(text: string): string {
  const ranges = protectedRanges(text);
  return text.replace(CITATION_RE, (marker, _raw: string, offset: number) =>
    isProtected(offset, ranges) ? marker : "",
  );
}

export function sanitizeCitations(text: string, sourceCount: number): string {
  const ranges = protectedRanges(text);
  return text.replace(CITATION_RE, (marker, raw: string, offset: number) => {
    if (isProtected(offset, ranges)) return marker;
    const position = Number(raw);
    return position >= 1 && position <= sourceCount ? marker : "";
  });
}

export function newCitations(text: string, sourceCount: number, seen: Set<number>): number[] {
  const ranges = protectedRanges(text);
  const found: number[] = [];
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text))) {
    if (isProtected(match.index, ranges)) continue;
    const position = Number(match[1]);
    if (position < 1 || position > sourceCount || seen.has(position)) continue;
    seen.add(position);
    found.push(position);
  }
  return found;
}

export function hasValidCitation(text: string, sourceCount: number): boolean {
  const ranges = protectedRanges(text);
  CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text))) {
    if (isProtected(match.index, ranges)) continue;
    const position = Number(match[1]);
    if (position >= 1 && position <= sourceCount) return true;
  }
  return false;
}
