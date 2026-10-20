import { createParser } from "eventsource-parser";
import { ApiError } from "../http";
import { appUrl } from "../env";

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

function headers(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": appUrl(),
    "X-Title": "Beamling",
  };
}

function mapStatus(status: number): { code: string; message: string } {
  if (status === 401) return { code: "INVALID_KEY", message: "OpenRouter rejected this key." };
  if (status === 402) {
    return { code: "INSUFFICIENT_CREDITS", message: "OpenRouter has insufficient credits for this key." };
  }
  if (status === 429) {
    return { code: "PROVIDER_RATE_LIMITED", message: "OpenRouter is rate-limiting this key. Try again shortly." };
  }
  if (status === 503) {
    return { code: "PROVIDER_UNAVAILABLE", message: "No OpenRouter provider is available for this model." };
  }
  return { code: "PROVIDER_ERROR", message: `OpenRouter returned HTTP ${status}.` };
}

async function readError(response: Response): Promise<ApiError> {
  let message = "";
  try {
    const body = (await response.json()) as OpenRouterErrorBody;
    message = body.error?.message ?? "";
  } catch {}
  const mapped = mapStatus(response.status);
  return new ApiError(mapped.code, message || mapped.message, response.status, "openrouter");
}

export interface OpenRouterKeyInfo {
  label?: string;
  limit?: number | null;
  usage?: number;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
}

export async function validateOpenRouterKey(key: string): Promise<OpenRouterKeyInfo> {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: headers(key),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as {
    data?: {
      label?: string;
      limit?: number | null;
      usage?: number;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
    };
  };
  return {
    label: body.data?.label,
    limit: body.data?.limit ?? null,
    usage: body.data?.usage,
    limitRemaining: body.data?.limit_remaining ?? null,
    isFreeTier: body.data?.is_free_tier,
  };
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

export async function openRouterChat(options: ChatOptions): Promise<ChatResult> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new ApiError("PROVIDER_ERROR", "OpenRouter returned an empty stream.", 502, "openrouter");

  let content = "";
  let model = options.model;
  let provider: string | undefined;
  let finishReason: string | undefined;
  let usage: ChatUsage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  let streamError: ApiError | null = null;

  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === "[DONE]") return;
      let chunk: {
        model?: string;
        provider?: string;
        error?: { code?: string | number; message?: string };
        choices?: { delta?: { content?: string }; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
        };
      };
      try {
        chunk = JSON.parse(event.data);
      } catch {
        return;
      }
      if (chunk.error) {
        streamError = new ApiError(
          "PROVIDER_ERROR",
          chunk.error.message ?? "OpenRouter failed mid-stream.",
          502,
          "openrouter",
        );
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
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw streamError;
  return { content, model, provider, finishReason, usage };
}
