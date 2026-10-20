import { isFakeProviders } from "../env";
import { searchBrave, validateBraveKey } from "./brave";
import { fakeChat, fakeSearch, fakeValidateKey } from "./fake";
import { openRouterChat, validateOpenRouterKey } from "./openrouter";

export { openRouterChat };

export async function validateProviderKey(
  provider: "openrouter" | "brave",
  key: string,
): Promise<void> {
  if (isFakeProviders()) {
    await fakeValidateKey(key);
    return;
  }
  if (provider === "openrouter") {
    await validateOpenRouterKey(key);
    return;
  }
  await validateBraveKey(key);
}

export async function search(
  provider: "brave",
  key: string,
  query: string,
  options: { count: number; freshnessDays?: number; signal?: AbortSignal },
) {
  if (isFakeProviders()) return fakeSearch(query, options.count, options.signal);
  return searchBrave(key, query, options);
}

export async function chat(options: {
  key: string;
  model: string;
  messages: Parameters<typeof openRouterChat>[0]["messages"];
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}) {
  if (isFakeProviders()) {
    return fakeChat({ messages: options.messages, signal: options.signal, onDelta: options.onDelta });
  }
  return openRouterChat(options);
}
