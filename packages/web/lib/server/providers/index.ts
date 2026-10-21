import { isFakeProviders } from "../env";
import { searchBrave, validateBraveKey } from "./brave";
import { fakeChat, fakeSearch, fakeValidateKey } from "./fake";
import { openRouterChat, validateOpenRouterKey, type ChatMessage, type ChatPurpose } from "./openrouter";

export async function validateProviderKey(
  provider: "openrouter" | "brave",
  key: string,
  plan: "free" | "paid" = "free",
): Promise<void> {
  if (isFakeProviders()) {
    await fakeValidateKey(key, provider);
    return;
  }
  if (provider === "openrouter") {
    await validateOpenRouterKey(key);
    return;
  }
  await validateBraveKey(key, plan);
}

export async function search(
  provider: "brave",
  key: string,
  query: string,
  options: { count: number; freshnessDays?: number; signal?: AbortSignal; plan?: "free" | "paid" },
) {
  if (isFakeProviders()) return fakeSearch(query, options.count, options.signal);
  return searchBrave(key, query, options);
}

export async function chat(options: {
  purpose: ChatPurpose;
  key: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}) {
  if (isFakeProviders()) {
    return fakeChat({
      purpose: options.purpose,
      messages: options.messages,
      signal: options.signal,
      onDelta: options.onDelta,
      onReasoning: options.onReasoning,
    });
  }
  return openRouterChat(options);
}
