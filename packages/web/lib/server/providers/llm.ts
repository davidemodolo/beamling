import { APICallError, streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage, type ProviderMetadata } from "ai";
import type { LlmProvider } from "../../contracts";
import { providerName } from "../../provider-catalog";
import { ApiError } from "../http";
import { log } from "../log";
import { unavailable } from "./errors";

/** Why a model call is made; fixture providers use it to pick their canned reply. */
export type ChatPurpose = "plan" | "gap" | "answer";

/** A user message part: text, or an image as base64 for models that read images. */
export type ChatPart = { type: "text"; text: string } | { type: "image"; image: string; mediaType: string };

export type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | ChatPart[] };

/** The text of a message, without its images. */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface ChatResult {
  content: string;
  /** The model that actually answered, as the provider reports it. */
  model: string;
  /** The upstream host, for routers that report one. */
  provider?: string;
  finishReason?: string;
  usage: ChatUsage;
}

/** One model step as the AI SDK reports it. */
export interface ModelStep {
  usage: LanguageModelUsage;
  providerMetadata?: ProviderMetadata;
  response?: { modelId: string };
}

/** What a model provider contributes; everything else (streaming, errors, usage) is shared. */
export interface LlmAdapter {
  model(key: string, apiModel: string): LanguageModel;
  /** Per-request options for this provider, such as usage accounting or switching reasoning off. */
  providerOptions?: Record<string, Record<string, never> | Record<string, unknown>>;
  /** Cost in USD and the upstream host for one step. */
  stepUsage(step: ModelStep): { costUsd: number; upstreamProvider?: string };
}

const CONTEXT_TOO_LARGE_RE = /context (length|window)|maximum context|too many tokens|prompt is too long/i;
// OpenRouter's wording for the daily cap on free models and for free models hidden by the account's data policy.
const FREE_LIMIT_RE = /free-models-per-day/i;
const DATA_POLICY_RE = /data policy/i;
// A shared upstream (e.g. the free tier behind a `:free` model) is throttled for everyone, not this key.
const UPSTREAM_LIMIT_RE = /rate-limited upstream/i;

/** Maps a model provider's HTTP status (or a mid-stream error code) to a stable Beamling error. */
export function modelHttpError(provider: LlmProvider, status: number, providerMessage = ""): ApiError {
  const name = providerName(provider);
  const detail = providerMessage.slice(0, 500);
  // The provider's own wording is what tells a key limit from upstream capacity; it carries no key or prompt.
  log.warn("Model provider error", { provider, status, detail: detail.slice(0, 300) });
  const error = (code: string, message: string, httpStatus: number) => new ApiError(code, message, httpStatus, provider);
  if (status === 400 && CONTEXT_TOO_LARGE_RE.test(detail)) {
    return error("CONTEXT_TOO_LARGE", "The question and sources are too long for this model.", 400);
  }
  if (status === 401 || status === 403) return error("CREDENTIAL_INVALID", `${name} rejected this key.`, 400);
  if (status === 402) return error("INSUFFICIENT_CREDITS", `${name} has insufficient credits for this key.`, 402);
  if (status === 404 && DATA_POLICY_RE.test(detail)) {
    return error(
      "MODEL_PRIVACY_SETTING",
      `${name}'s privacy settings block this model. Allow free models in your ${name} privacy settings, or pick a paid model.`,
      400,
    );
  }
  if (status === 404) return error("MODEL_NOT_FOUND", `${name} does not offer this model right now.`, 400);
  if (status === 429 && FREE_LIMIT_RE.test(detail)) {
    return error(
      "FREE_LIMIT_REACHED",
      `You have used today's free requests on ${name}. They reset at midnight UTC, or pick a paid model in Settings.`,
      429,
    );
  }
  if (status === 429 && UPSTREAM_LIMIT_RE.test(detail)) {
    return error("MODEL_BUSY", "This model is busy for everyone right now. Try again shortly, or pick another model in Settings.", 429);
  }
  if (status === 429) return error("PROVIDER_RATE_LIMITED", `${name} is rate-limiting this key. Try again shortly.`, 429);
  if (status === 408 || status >= 500) return unavailable(provider, `${name} has no capacity for this model right now.`);
  return error("PROVIDER_ERROR", detail || `${name} returned HTTP ${status}.`, 502);
}

/** Normalizes anything a model call throws or streams as an error. A caller's stop stays an abort. */
export function modelError(provider: LlmProvider, error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return error;
  if (error instanceof ApiError) return error;
  if (APICallError.isInstance(error)) {
    return modelHttpError(provider, error.statusCode ?? 502, error.message);
  }
  // Routers report some failures as a JSON error with an HTTP-like code inside the stream.
  const code = Number((error as { code?: unknown } | null)?.code);
  if (Number.isInteger(code) && code >= 400) {
    return modelHttpError(provider, code, String((error as { message?: unknown }).message ?? ""));
  }
  return unavailable(provider, `${providerName(provider)} could not be reached. Try again shortly.`);
}

/** The non-system messages, in the AI SDK's shape. */
function conversation(messages: ChatMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "user") return [{ role: "user", content: message.content }];
    if (message.role === "assistant") return [{ role: "assistant", content: message.content }];
    return [];
  });
}

export interface StreamChatOptions {
  provider: LlmProvider;
  adapter: LlmAdapter;
  key: string;
  apiModel: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

/** Streams one completion through the AI SDK, forwarding text and reasoning as they arrive. */
export async function streamChat(options: StreamChatOptions): Promise<ChatResult> {
  const { provider, adapter, signal } = options;
  // The AI SDK takes system prompts as instructions, separate from the conversation.
  const instructions = options.messages.filter((message) => message.role === "system").map(messageText);
  const result = streamText({
    model: adapter.model(options.key, options.apiModel),
    instructions: instructions.length ? instructions.join("\n\n") : undefined,
    messages: conversation(options.messages),
    maxOutputTokens: options.maxTokens,
    temperature: 0.2,
    abortSignal: signal,
    maxRetries: 0,
    providerOptions: adapter.providerOptions as Parameters<typeof streamText>[0]["providerOptions"],
  });

  let content = "";
  let model = options.apiModel;
  let upstream: string | undefined;
  let finishReason: string | undefined;
  let finished = false;
  const usage: ChatUsage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          content += part.text;
          options.onDelta?.(part.text);
          break;
        case "reasoning-delta":
          options.onReasoning?.(part.text);
          break;
        case "finish-step": {
          const step = adapter.stepUsage(part);
          usage.promptTokens += part.usage.inputTokens ?? 0;
          usage.completionTokens += part.usage.outputTokens ?? 0;
          usage.costUsd += step.costUsd;
          model = part.response.modelId || model;
          upstream = step.upstreamProvider ?? upstream;
          break;
        }
        case "finish":
          finishReason = part.finishReason;
          // A stream that just stops has no provider finish reason: the answer may be cut off.
          finished = part.rawFinishReason !== undefined;
          break;
        case "error":
          throw part.error;
        case "abort":
          throw signal?.reason ?? new DOMException("Aborted", "AbortError");
      }
    }
  } catch (error) {
    throw modelError(provider, error, signal);
  }
  if (!finished) throw unavailable(provider, `${providerName(provider)} ended the stream before it finished.`);
  return { content, model, provider: upstream, finishReason, usage };
}
