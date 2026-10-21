import { isFakeProviders } from "../env";
import type { SearchProvider } from "../../types";
import { searchBrave, validateBraveKey } from "./brave";
import { searchExa, validateExaKey } from "./exa";
import { fakeChat, fakeSearch, fakeValidateKey } from "./fake";
import { openRouterChat, validateOpenRouterKey, type ChatMessage, type ChatPurpose } from "./openrouter";
import type { RetrievedSource, SearchOptions } from "./shared";
import { searchTavily, validateTavilyKey } from "./tavily";

export type ProviderKeyName = "openrouter" | SearchProvider;

export async function validateProviderKey(
  provider: ProviderKeyName,
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
  if (provider === "tavily") {
    await validateTavilyKey(key);
    return;
  }
  if (provider === "exa") {
    await validateExaKey(key);
    return;
  }
  await validateBraveKey(key, plan);
}

export async function search(
  provider: SearchProvider,
  key: string,
  query: string,
  options: SearchOptions,
): Promise<RetrievedSource[]> {
  if (isFakeProviders()) return fakeSearch(query, options.count, options.signal, provider);
  if (provider === "tavily") return searchTavily(key, query, options);
  if (provider === "exa") return searchExa(key, query, options);
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
