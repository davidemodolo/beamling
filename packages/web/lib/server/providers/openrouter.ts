import { createParser } from "eventsource-parser";
import { ApiError } from "../http";
import { appUrl } from "../env";
import { providerFetch, transportError, unavailable } from "./errors";

/** Why a model call is made; fixture providers use it to pick their canned reply. */
export type ChatPurpose = "plan" | "gap" | "answer";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface ChatResult {
  content: string;
  model: string;
  provider?: string;
  finishReason?: string;
  usage: ChatUsage;
}

interface OpenRouterErrorBody {
  error?: { code?: number | string; message?: string };
}

const VALIDATE_TIMEOUT_MS = 15_000;
const CONTEXT_TOO_LARGE_RE = /context (length|window)|maximum context|too many tokens|prompt is too long/i;

function headers(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": appUrl(),
    "X-Title": "Beamling",
  };
}

/** Maps an OpenRouter HTTP status (or a mid-stream error code) to a stable Beamling error. */
export function openRouterError(status: number, providerMessage = ""): ApiError {
  const error = (code: string, message: string, httpStatus: number) =>
    new ApiError(code, message, httpStatus, "openrouter");
  if (status === 400 && CONTEXT_TOO_LARGE_RE.test(providerMessage)) {
    return error("CONTEXT_TOO_LARGE", "The question and sources are too long for this model.", 400);
  }
  if (status === 401 || status === 403) return error("CREDENTIAL_INVALID", "OpenRouter rejected this key.", 400);
  if (status === 402) {
    return error("INSUFFICIENT_CREDITS", "OpenRouter has insufficient credits for this key.", 402);
  }
  if (status === 404) return error("MODEL_NOT_FOUND", "OpenRouter does not offer this model right now.", 400);
  if (status === 429) {
    return error("PROVIDER_RATE_LIMITED", "OpenRouter is rate-limiting this key. Try again shortly.", 429);
  }
  if (status === 408 || status >= 500) {
    return unavailable("openrouter", "No OpenRouter provider is available for this model right now.");
  }
  return error("PROVIDER_ERROR", providerMessage || `OpenRouter returned HTTP ${status}.`, 502);
}

async function readError(response: Response): Promise<ApiError> {
  let message = "";
  try {
    const body = (await response.json()) as OpenRouterErrorBody;
    message = body.error?.message ?? "";
  } catch {}
  return openRouterError(response.status, message);
}

export async function validateOpenRouterKey(key: string): Promise<void> {
  const response = await providerFetch("openrouter", "https://openrouter.ai/api/v1/key", {
    headers: headers(key),
    signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  await response.arrayBuffer().catch(() => {});
}

interface ChatOptions {
  key: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

interface StreamChunk {
  model?: string;
  provider?: string;
  error?: { code?: string | number; message?: string };
  choices?: { delta?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

export async function openRouterChat(options: ChatOptions): Promise<ChatResult> {
  const response = await providerFetch(
    "openrouter",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: headers(options.key),
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.2,
        stream: true,
      }),
      signal: options.signal,
      cache: "no-store",
    },
    options.signal,
  );
  if (!response.ok) throw await readError(response);
  if (!response.body) throw unavailable("openrouter", "OpenRouter returned an empty stream.");

  let content = "";
  let model = options.model;
  let provider: string | undefined;
  let finishReason: string | undefined;
  let usage: ChatUsage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  let streamError: ApiError | null = null;

  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === "[DONE]") return;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        return;
      }
      if (chunk.error) {
        const code = Number(chunk.error.code);
        streamError = Number.isInteger(code) && code >= 400
          ? openRouterError(code, chunk.error.message)
          : unavailable("openrouter", chunk.error.message || "OpenRouter failed mid-stream.");
        return;
      }
      if (chunk.model) model = chunk.model;
      if (chunk.provider) provider = chunk.provider;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        options.onDelta?.(delta);
      }
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? usage.promptTokens,
          completionTokens: chunk.usage.completion_tokens ?? usage.completionTokens,
          costUsd: chunk.usage.cost ?? usage.costUsd,
        };
      }
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      if (streamError) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    if (!streamError) parser.feed(decoder.decode());
  } catch (error) {
    // A connection reset mid-stream is an outage; a stop from the caller stays an abort.
    throw transportError("openrouter", error, options.signal);
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw streamError;
  return { content, model, provider, finishReason, usage };
}
