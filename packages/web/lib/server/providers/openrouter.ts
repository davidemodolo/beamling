import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { appUrl } from "../env";
import { providerFetch } from "./errors";
import { modelHttpError, type LlmAdapter } from "./llm";

const VALIDATE_TIMEOUT_MS = 15_000;

/** Checks the key with the key-info endpoint, which spends no generation tokens. */
export async function validateOpenRouterKey(key: string): Promise<void> {
  const response = await providerFetch("openrouter", "https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}`, "HTTP-Referer": appUrl(), "X-Title": "Beamling" },
    signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    let message = "";
    try {
      message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {}
    throw modelHttpError("openrouter", response.status, message);
  }
  await response.arrayBuffer().catch(() => {});
}

interface OpenRouterMetadata {
  provider?: string;
  usage?: { cost?: number };
}

export const openRouterModels: LlmAdapter = {
  model: (key, apiModel) =>
    createOpenRouter({
      apiKey: key,
      appName: "Beamling",
      headers: { "HTTP-Referer": appUrl() },
      compatibility: "strict",
    }).chat(apiModel),
  // OpenRouter reports the billed cost and the upstream host when usage accounting is on.
  providerOptions: { openrouter: { usage: { include: true } } },
  stepUsage: ({ providerMetadata }) => {
    const metadata = providerMetadata?.openrouter as OpenRouterMetadata | undefined;
    return { costUsd: metadata?.usage?.cost ?? 0, upstreamProvider: metadata?.provider || undefined };
  },
};
