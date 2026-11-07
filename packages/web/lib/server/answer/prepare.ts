import { DEFAULT_LLM_MODEL, isAllowedModel, isSearchProvider } from "../../provider-catalog";
import type { Message, Mode, SearchProvider } from "../../types";
import { ApiError } from "../http";
import { log } from "../log";
import {
  completeAssistant,
  conversationExists,
  createConversation,
  createExchange,
  deleteConversationIfEmpty,
  ensureSettings,
  getCredentialRow,
  getHistory,
  readCredentialKey,
  trimConversations,
} from "../repo";
import { credentialMissing, type PreparedChat } from "./context";

async function readKey(userId: string, row: Parameters<typeof readCredentialKey>[1], provider: "openrouter" | SearchProvider) {
  try {
    return await readCredentialKey(userId, row);
  } catch (error) {
    log.error("Stored credential could not be decrypted", error, { provider });
    return null;
  }
}

/**
 * Everything that can fail before streaming starts: settings, keys, conversation and the stored
 * exchange. Errors here are returned as plain JSON responses. A retry reuses the stored question
 * and replaces the failed or stopped answer.
 */
export async function prepareChat(input: {
  userId: string;
  conversationId?: string;
  mode: Mode;
  searchProvider?: SearchProvider;
  question?: string;
  retryOf?: string;
}): Promise<PreparedChat> {
  const startedAt = Date.now();
  const settings = await ensureSettings(input.userId);
  const model = isAllowedModel(settings.llmModel) ? settings.llmModel : DEFAULT_LLM_MODEL;
  const searchProvider =
    input.searchProvider && isSearchProvider(input.searchProvider) ? input.searchProvider : settings.defaultSearchProvider;

  let conversationId = input.conversationId;
  let createdHere = false;
  if (conversationId) {
    if (!(await conversationExists(input.userId, conversationId))) {
      throw new ApiError("CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
    }
  } else {
    conversationId = (await createConversation(input.userId, input.mode)).id;
    createdHere = true;
  }

  try {
    const [llmCredential, searchCredential] = await Promise.all([
      getCredentialRow(input.userId, "llm", "openrouter"),
      getCredentialRow(input.userId, "search", searchProvider),
    ]);
    if (!llmCredential) throw credentialMissing("openrouter");
    if (!searchCredential) throw credentialMissing(searchProvider);
    const llmKey = await readKey(input.userId, llmCredential, "openrouter");
    const searchKey = await readKey(input.userId, searchCredential, searchProvider);
    for (const [key, provider] of [[llmKey, "openrouter"], [searchKey, searchProvider]] as const) {
      if (key === null) {
        throw new ApiError("CREDENTIAL_UNREADABLE", "Your saved key can no longer be read. Replace it in Settings.", 400, provider);
      }
    }

    const { userMessage, assistantMessage, questionText } = await createExchange({
      userId: input.userId,
      conversationId,
      mode: input.mode,
      llmModel: model,
      searchProvider,
      question: input.question,
      retryOf: input.retryOf,
    });
    let history: Message[];
    try {
      history = await getHistory(input.userId, conversationId, userMessage.createdAt);
    } catch (error) {
      // The exchange is stored but will never run: close it now, or it blocks the conversation for minutes.
      await completeAssistant({
        userId: input.userId,
        messageId: assistantMessage.id,
        content: "",
        status: "error",
        errorCode: "INTERNAL",
        errorMessage: "The answer could not be started.",
      }).catch(() => {});
      throw error;
    }
    // Only once the question is stored: a request that fails earlier must not cost an older conversation.
    const removed = await trimConversations(input.userId, conversationId).catch((error) => {
      log.error("Conversation cap could not be applied", error);
      return [];
    });

    return {
      userId: input.userId,
      conversationId,
      messageId: assistantMessage.id,
      userMessageId: userMessage.id,
      question: questionText,
      mode: input.mode,
      model,
      llmKey: llmKey as string,
      searchProvider,
      searchKey: searchKey as string,
      searchCredentialId: searchCredential.id,
      searchPlan: searchCredential.provider === "brave" && searchCredential.plan === "paid" ? "paid" : "free",
      history,
      startedAt,
      removed,
    };
  } catch (error) {
    // Server-created conversations are safe to reclaim immediately. A browser-created row stays so
    // the user can retry; the cleanup job removes abandoned empty rows after an hour.
    if (createdHere) await deleteConversationIfEmpty(input.userId, conversationId).catch(() => {});
    throw error;
  }
}
