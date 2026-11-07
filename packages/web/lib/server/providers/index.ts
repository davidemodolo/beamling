/**
 * The provider registry: one adapter per provider. A model provider supplies an AI SDK model
 * factory; a search provider supplies a search function; both supply a key check. The mapped type
 * makes the compiler require the right capabilities for every id in `contracts.ts`.
 */
import type { CredentialProvider, LlmProvider, SearchProvider } from "../../contracts";
import type { ModelInfo } from "../../provider-catalog";
import { isFakeProviders } from "../env";
import { searchBrave, validateBraveKey } from "./brave";
import { deepSeekModels, searchDeepSeek, validateDeepSeekKey } from "./deepseek";
import { searchExa, validateExaKey } from "./exa";
import { fakeChat, fakeSearch, fakeValidateKey } from "./fake";
import { streamChat, type ChatMessage, type ChatPurpose, type ChatResult, type LlmAdapter } from "./llm";
import { openRouterModels, validateOpenRouterKey } from "./openrouter";
import type { RetrievedSource, SearchOptions } from "./shared";
import { searchTavily, validateTavilyKey } from "./tavily";

type SearchFn = (key: string, query: string, options: SearchOptions) => Promise<RetrievedSource[]>;
type KeyCheck = (key: string, options: { plan: "free" | "paid" }) => Promise<void>;

type Adapter<P extends CredentialProvider> = { validateKey: KeyCheck } & (P extends LlmProvider ? { llm: LlmAdapter } : unknown) &
  (P extends SearchProvider ? { search: SearchFn } : unknown);

const ADAPTERS: { [P in CredentialProvider]: Adapter<P> } = {
  openrouter: { validateKey: (key) => validateOpenRouterKey(key), llm: openRouterModels },
  deepseek: { validateKey: (key) => validateDeepSeekKey(key), llm: deepSeekModels, search: searchDeepSeek },
  brave: { validateKey: (key, { plan }) => validateBraveKey(key, plan), search: searchBrave },
  tavily: { validateKey: (key) => validateTavilyKey(key), search: searchTavily },
  exa: { validateKey: (key) => validateExaKey(key), search: searchExa },
};

export const llmAdapter = (provider: LlmProvider): LlmAdapter => ADAPTERS[provider].llm;

export async function validateProviderKey(provider: CredentialProvider, key: string, plan: "free" | "paid" = "free"): Promise<void> {
  if (isFakeProviders()) return fakeValidateKey(key, provider);
  return ADAPTERS[provider].validateKey(key, { plan });
}

export async function search(provider: SearchProvider, key: string, query: string, options: SearchOptions): Promise<RetrievedSource[]> {
  if (isFakeProviders()) return fakeSearch(query, options.count, options.signal, provider);
  return ADAPTERS[provider].search(key, query, options);
}

export async function chat(options: {
  purpose: ChatPurpose;
  key: string;
  model: ModelInfo;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}): Promise<ChatResult> {
  if (isFakeProviders()) {
    return fakeChat({
      purpose: options.purpose,
      messages: options.messages,
      signal: options.signal,
      onDelta: options.onDelta,
      onReasoning: options.onReasoning,
    });
  }
  return streamChat({
    provider: options.model.provider,
    adapter: llmAdapter(options.model.provider),
    key: options.key,
    apiModel: options.model.apiModel,
    messages: options.messages,
    maxTokens: options.maxTokens,
    signal: options.signal,
    onDelta: options.onDelta,
    onReasoning: options.onReasoning,
  });
}
