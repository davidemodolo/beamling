"use client";

import { isFile, isImage, MAX_CONTEXT_FILES, MAX_CONTEXT_IMAGES, type Attachment, type FileUpload, type ImageUpload } from "./attachments";
import { HISTORY_MESSAGES } from "./data";
import { loadFiles, loadImages, saveImages, type StoredImage } from "./image-store";
import { toBase64, type PreparedFile, type PreparedImage } from "./images";
import type { ThreadMessage } from "./store/threads";

/**
 * Earlier attachments the next answer can see: those on the stored messages in the history window
 * before the new question (or before the replaced answer, which includes its own question), newest
 * first. Questions that never reached the server are skipped, as the server's history skips them.
 */
export function historyAttachments(messages: ThreadMessage[], retryOf?: string): { images: string[]; files: string[] } {
  const end = retryOf ? messages.findIndex((message) => message.id === retryOf) : -1;
  const earlier = (end < 0 ? messages : messages.slice(0, end))
    .filter((message) => message.local !== "failed")
    .slice(-(HISTORY_MESSAGES + 1))
    .flatMap((message) => message.attachments ?? [])
    .reverse();
  return {
    images: earlier.filter(isImage).map((item) => item.id).slice(0, MAX_CONTEXT_IMAGES),
    files: earlier.filter(isFile).map((item) => item.id).slice(0, MAX_CONTEXT_FILES),
  };
}

const upload = async (image: StoredImage): Promise<ImageUpload> => ({
  id: image.id,
  mediaType: image.mediaType,
  data: await toBase64(image.blob),
});

const imageUploads = async (ids: string[]) => (ids.length ? Promise.all((await loadImages(ids)).map(upload)) : []);
const fileUploads = async (ids: string[]): Promise<FileUpload[]> =>
  ids.length ? (await loadFiles(ids)).map(({ id, name, text }) => ({ id, name, text })) : [];
const some = <T,>(list: T[]): T[] | undefined => (list.length ? list : undefined);

/** What a chat request carries besides the question. */
export interface ChatUploads {
  attachments?: ImageUpload[];
  context?: ImageUpload[];
  files?: FileUpload[];
  contextFiles?: FileUpload[];
}

/**
 * The image bytes and file text for a chat request. Newly picked ones are kept on this device
 * first; then the question's and the earlier ones are read from it. Expired ones are left out.
 */
export async function chatUploads(
  conversationId: string,
  question: Attachment[],
  picked: { images: PreparedImage[]; files: PreparedFile[] },
  context: { images: string[]; files: string[] },
): Promise<ChatUploads> {
  const savedAt = Date.now();
  if (picked.images.length || picked.files.length) {
    await saveImages([
      ...picked.images.map((image) => ({ ...image, conversationId, savedAt })),
      ...picked.files.map((file) => ({ ...file, kind: "text" as const, conversationId, savedAt })),
    ]);
  }
  const ids = (items: Attachment[]) => items.map((item) => item.id);
  const [attachments, contextImages, files, contextFiles] = await Promise.all([
    imageUploads(ids(question.filter(isImage))),
    imageUploads(context.images),
    fileUploads(ids(question.filter(isFile))),
    fileUploads(context.files),
  ]);
  return { attachments: some(attachments), context: some(contextImages), files: some(files), contextFiles: some(contextFiles) };
}
