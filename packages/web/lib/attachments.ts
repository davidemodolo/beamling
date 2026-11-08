/**
 * Images attached to a question. The server never stores image bytes: the browser keeps each image
 * for IMAGE_RETENTION_DAYS and sends it again while its question is in the prompt's history window.
 * The server stores only that the question had images (id and type), so later prompts can say an
 * image was there and is no longer available.
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
/** How long the browser keeps an image; after that the model can no longer see it. */
export const IMAGE_RETENTION_DAYS = 7;

/** A stored image reference on a question: id and type, never the bytes. */
export interface Attachment {
  id: string;
  kind: "image";
  mediaType: ImageMediaType;
}

/** Image bytes sent with a chat request, base64 without a data URL prefix. */
export interface ImageUpload {
  id: string;
  mediaType: ImageMediaType;
  data: string;
}

export const isImageMediaType = (value: string): value is ImageMediaType =>
  (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);

/** The stored reference for an image, without its bytes. */
export const toAttachment = (image: { id: string; mediaType: ImageMediaType }): Attachment => ({
  id: image.id,
  kind: "image",
  mediaType: image.mediaType,
});
