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
  status?: number;
  query?: string;
  cause?: ErrorSummary;
}

const MAX_DEPTH = 4;
const MAX_MESSAGE = 300;
const BEARER = /(Bearer\s+)[^\s"']+/gi;
const PROVIDER_KEY = /\b(?:sk-or-v1-|BSA|tvly-|exa-|phx_)[A-Za-z0-9_-]{8,}/g;
const BODY_START = /\b(?:Text|responseBody|requestBodyValues|body|response):\s/i;

/** Provider errors can embed request or response bodies; never let message content reach logs. */
function safeMessage(error: Error): string {
  let message = error.message;
  const body = message.search(BODY_START);
  if (body > 0) message = `${message.slice(0, body)}[body omitted]`;
  return message.replace(BEARER, "$1[redacted]").replace(PROVIDER_KEY, "[redacted]").slice(0, MAX_MESSAGE);
}

export function summarizeError(error: unknown, depth = 0): ErrorSummary | string {
  if (!(error instanceof Error)) return String(error).slice(0, MAX_MESSAGE);
  const code = (error as { code?: unknown }).code;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  const query = (error as { query?: unknown }).query;
  const isQueryError = typeof query === "string";
  const summary: ErrorSummary = {
    name: error.name,
    message: isQueryError ? "Database query failed" : safeMessage(error),
  };
  if (typeof code === "string") summary.code = code;
  if (typeof statusCode === "number") summary.status = statusCode;
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
