/**
 * Images and text files attached to a question. The server never stores their content: the browser
 * keeps each one for IMAGE_RETENTION_DAYS and sends it again while its question is in the prompt's
 * history window. The server stores only that the question had them (id, and type or name), so
 * later prompts can say an attachment was there and is no longer available.
 */
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Images on one question. */
export const MAX_IMAGES_PER_QUESTION = 4;
/** Earlier images re-sent with one request, newest first. */
export const MAX_CONTEXT_IMAGES = 4;
/** Decoded size per image, after the browser resizes it. */
export const MAX_IMAGE_BYTES = 1_500_000;
/** Longest edge the browser resizes to before upload. */
export const IMAGE_MAX_EDGE = 1568;
/** How long the browser keeps an image or a text file; after that the model can no longer see it. */
export const IMAGE_RETENTION_DAYS = 7;

/** Text files (.md, .txt) on one question. */
export const MAX_FILES_PER_QUESTION = 3;
/** Earlier text files re-sent with one request, newest first. */
export const MAX_CONTEXT_FILES = 3;
/** Size of one text file, in bytes on the device and in characters on the server. */
export const MAX_FILE_BYTES = 100_000;
/** Characters of file text one prompt reads, over all files; the rest is cut with a note. */
export const MAX_FILE_PROMPT_CHARS = 60_000;
export const MAX_FILE_NAME_CHARS = 120;
export const TEXT_FILE_EXTENSIONS = [".md", ".txt"] as const;
/** What the file picker offers: images and text files. */
export const ATTACH_ACCEPT = `image/*,${TEXT_FILE_EXTENSIONS.join(",")},text/plain,text/markdown`;

/** A stored image reference on a question: id and type, never the bytes. */
export interface ImageAttachment {
  id: string;
  kind: "image";
  mediaType: ImageMediaType;
}

/** A stored text file reference on a question: id and name, never the content. */
export interface FileAttachment {
  id: string;
  kind: "text";
  name: string;
}

export type Attachment = ImageAttachment | FileAttachment;

export const isImage = (item: Attachment): item is ImageAttachment => item.kind === "image";
export const isFile = (item: Attachment): item is FileAttachment => item.kind === "text";

/** A text file sent with a chat request. */
export interface FileUpload {
  id: string;
  name: string;
  text: string;
}

export const isTextFileName = (name: string): boolean =>
  TEXT_FILE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

/** Image bytes sent with a chat request, base64 without a data URL prefix. */
export interface ImageUpload {
  id: string;
  mediaType: ImageMediaType;
  data: string;
}

export const isImageMediaType = (value: string): value is ImageMediaType =>
  (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);

/** The stored reference for an image, without its bytes. */
export const toAttachment = (image: { id: string; mediaType: ImageMediaType }): ImageAttachment => ({
  id: image.id,
  kind: "image",
  mediaType: image.mediaType,
});

/** The stored reference for a text file, without its content. */
export const toFileAttachment = (file: { id: string; name: string }): FileAttachment => ({
  id: file.id,
  kind: "text",
  name: file.name,
});
