/**
 * Structured JSON logs. Errors are reduced to their name, Postgres code and message: drizzle query
 * errors embed the SQL parameters (message text, token hashes, ciphertext), so their own message
 * is replaced by the failing query's text.
 */

type Level = "info" | "warn" | "error";

interface ErrorSummary {
  name: string;
  message: string;
  code?: string;
  query?: string;
  cause?: ErrorSummary;
}

const MAX_DEPTH = 4;

export function summarizeError(error: unknown, depth = 0): ErrorSummary | string {
  if (!(error instanceof Error)) return String(error).slice(0, 500);
  const code = (error as { code?: unknown }).code;
  const query = (error as { query?: unknown }).query;
  const isQueryError = typeof query === "string";
  const summary: ErrorSummary = {
    name: error.name,
    message: isQueryError ? "Database query failed" : error.message.slice(0, 500),
  };
  if (typeof code === "string") summary.code = code;
  if (isQueryError) summary.query = query.slice(0, 300);
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    const cause = summarizeError(error.cause, depth + 1);
    if (typeof cause !== "string") summary.cause = cause;
  }
  return summary;
}

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  const entry = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, error?: unknown, fields?: Record<string, unknown>) =>
    write("error", message, { ...fields, ...(error === undefined ? {} : { error: summarizeError(error) }) }),
};
