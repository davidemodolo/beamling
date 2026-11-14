import { toAttachment, toFileAttachment, type Attachment, type FileUpload, type ImageUpload } from "../../attachments";
import { credentialKind, isSearchProvider, type CredentialProvider } from "../../contracts";
import { DEFAULT_LLM_MODEL, modelInfo } from "../../provider-catalog";
import type { Message, Mode, SearchProvider } from "../../types";
import { ApiError } from "../http";
import { log } from "../log";
import {
  assertCanAsk,
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

/** The provider's stored key, or a 400 that names the provider when it is missing or unreadable. */
async function providerKey(userId: string, provider: CredentialProvider) {
  const row = await getCredentialRow(userId, credentialKind(provider), provider);
  if (!row) throw credentialMissing(provider);
  try {
    return { row, key: await readCredentialKey(userId, row) };
  } catch (error) {
    log.error("Stored credential could not be decrypted", error, { provider });
    throw new ApiError("CREDENTIAL_UNREADABLE", "Your saved key can no longer be read. Replace it in Settings.", 400, provider);
  }
}

/** A model that cannot read images is refused new ones; earlier images are then marked unavailable in the prompt. */
function noVision(modelName: string): ApiError {
  return new ApiError("MODEL_NO_VISION", `${modelName} cannot read images. Pick a model that can in Settings, or remove the images.`, 400);
}

/**
 * The uploads the model will see: the question's and those of earlier questions in the history
 * window, in that order. Anything else the browser sent is ignored.
 */
function allowedUploads<T extends { id: string }>(
  uploads: T[],
  kind: Attachment["kind"],
  attachments: Attachment[],
  history: Message[],
): T[] {
  const stored = [...attachments, ...history.flatMap((message) => message.attachments ?? [])];
  const allowed = new Set(stored.filter((item) => item.kind === kind).map((item) => item.id));
  const seen = new Set<string>();
  return uploads.filter((upload) => allowed.has(upload.id) && !seen.has(upload.id) && seen.add(upload.id));
}

/**
 * Everything that can fail before streaming starts: settings, keys, conversation and the stored
 * exchange. Errors here are returned as plain JSON responses. With `retryOf` the latest answer is
 * replaced: its stored question is reused, or rewritten when `question` is sent too.
 */
export async function prepareChat(input: {
  userId: string;
  conversationId?: string;
  mode: Mode;
  searchProvider?: SearchProvider;
  question?: string;
  /** The new question's images. */
  attachments?: ImageUpload[];
  /** Earlier images the browser still has; only those in the history window are used. */
  context?: ImageUpload[];
  /** The new question's text files. */
  files?: FileUpload[];
  /** Earlier text files the browser still has; only those in the history window are used. */
  contextFiles?: FileUpload[];
  retryOf?: string;
}): Promise<PreparedChat> {
  const startedAt = Date.now();
  const settings = await ensureSettings(input.userId);
  const llm = modelInfo(settings.llmModel) ?? modelInfo(DEFAULT_LLM_MODEL)!;
  const uploads = input.attachments ?? [];
  const fileUploads = input.files ?? [];
  if (uploads.length && !llm.vision) throw noVision(llm.name);
  const searchProvider =
    input.searchProvider && isSearchProvider(input.searchProvider) ? input.searchProvider : settings.defaultSearchProvider;

  // Retries replace an answer, so only new questions count against storage and the per-chat cap.
  if (!input.retryOf) await assertCanAsk(input.userId, input.conversationId);

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
    // One provider can serve both the model and search with the same key; it is read once.
    const llmCredential = await providerKey(input.userId, llm.provider);
    const searchCredential =
      (searchProvider as CredentialProvider) === llm.provider ? llmCredential : await providerKey(input.userId, searchProvider);

    const { userMessage, assistantMessage, questionText, attachments } = await createExchange({
      userId: input.userId,
      conversationId,
      mode: input.mode,
      llmModel: llm.id,
      searchProvider,
      question: input.question,
      attachments: [...uploads.map(toAttachment), ...fileUploads.map(toFileAttachment)],
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
    const images = llm.vision ? allowedUploads([...uploads, ...(input.context ?? [])], "image", attachments, history) : [];
    const files = allowedUploads([...fileUploads, ...(input.contextFiles ?? [])], "text", attachments, history);

    return {
      userId: input.userId,
      conversationId,
      messageId: assistantMessage.id,
      userMessageId: userMessage.id,
      question: questionText,
      attachments,
      images,
      files,
      imageIds: new Set([...images, ...files].map((upload) => upload.id)),
      mode: input.mode,
      llm,
      llmKey: llmCredential.key,
      searchProvider,
      searchKey: searchCredential.key,
      searchCredentialId: searchCredential.row.id,
      searchPlan: searchCredential.row.plan ?? "free",
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
