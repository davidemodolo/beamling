"use client";

import { MAX_CONTEXT_IMAGES, type Attachment, type ImageUpload } from "./attachments";
import { HISTORY_MESSAGES } from "./data";
import { loadImages, saveImages, type StoredImage } from "./image-store";
import { toBase64, type PreparedImage } from "./images";
import type { ThreadMessage } from "./store/threads";

/**
 * Ids of earlier images the next answer can see: those on the stored messages in the history window
 * before the new question (or before the retried answer, which includes its own question), newest
 * first. Questions that never reached the server are skipped, as the server's history skips them.
 */
export function historyImageIds(messages: ThreadMessage[], retryOf?: string): string[] {
  const end = retryOf ? messages.findIndex((message) => message.id === retryOf) : -1;
  return (end < 0 ? messages : messages.slice(0, end))
    .filter((message) => message.local !== "failed")
    .slice(-(HISTORY_MESSAGES + 1))
    .flatMap((message) => message.attachments ?? [])
    .map((item) => item.id)
    .reverse()
    .slice(0, MAX_CONTEXT_IMAGES);
}

const upload = async (image: StoredImage): Promise<ImageUpload> => ({
  id: image.id,
  mediaType: image.mediaType,
  data: await toBase64(image.blob),
});

const uploads = async (ids: string[]) => (ids.length ? Promise.all((await loadImages(ids)).map(upload)) : []);

/**
 * The image bytes for a chat request. Newly picked images are kept on this device first; then the
 * question's images and the earlier ones are read from it. Images that expired are left out.
 */
export async function chatImages(
  conversationId: string,
  question: Attachment[],
  picked: PreparedImage[],
  contextIds: string[],
): Promise<{ attachments?: ImageUpload[]; context?: ImageUpload[] }> {
  if (picked.length) await saveImages(picked.map((image) => ({ ...image, conversationId, savedAt: Date.now() })));
  const [attachments, context] = await Promise.all([uploads(question.map((item) => item.id)), uploads(contextIds)]);
  return { attachments: attachments.length ? attachments : undefined, context: context.length ? context : undefined };
}
