const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function dayGroup(iso: string, now = new Date()): "Today" | "Yesterday" | "Previous" {
  const d = new Date(iso);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return "Previous";
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

/** "1 source", "3 sources"; pass `many` for irregular plurals. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "A, B or C". */
export function orList(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : (items[0] ?? "");
}

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Collapse runs of whitespace (including newlines) into single spaces and trim the ends. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
