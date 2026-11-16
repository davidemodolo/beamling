import { z } from "zod";
import {
  IMAGE_MEDIA_TYPES,
  isTextFileName,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_CHARS,
  MAX_IMAGE_BYTES,
  type FileUpload,
  type ImageMediaType,
  type ImageUpload,
} from "../attachments";
import { cleanText } from "./http";
import { IMAGE_SIGNATURES } from "./image-type";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** File signatures: the declared type must match the bytes, so nothing else reaches a model. */
const SIGNATURES: Record<ImageMediaType, (bytes: Buffer) => boolean> = IMAGE_SIGNATURES;

/** An image in a chat request: a known type, at most MAX_IMAGE_BYTES, and bytes that match the type. */
export const imageUpload: z.ZodType<ImageUpload> = z
  .object({
    id: z.string().uuid(),
    mediaType: z.enum(IMAGE_MEDIA_TYPES, { message: "Attach a JPEG, PNG or WebP image." }),
    data: z.string().max(MAX_BASE64_CHARS, "An attached image is too large.").regex(BASE64, "An attached image could not be read."),
  })
  .refine((image) => SIGNATURES[image.mediaType](Buffer.from(image.data.slice(0, 24), "base64")), {
    message: "An attached image could not be read.",
  });

/** Upper bound of one file's share of a request body: its text, with room for JSON escaping. */
export const MAX_FILE_BODY_BYTES = MAX_FILE_BYTES * 2;

/** A text file in a chat request: a .md or .txt name and at most MAX_FILE_BYTES characters of text. */
export const fileUpload: z.ZodType<FileUpload> = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .transform((name) => cleanText(name).replace(/[\\/\n\r"<>]/g, "_").trim().slice(-MAX_FILE_NAME_CHARS))
    .refine(isTextFileName, "Attach a .md or .txt file."),
  text: z
    .string()
    .max(MAX_FILE_BYTES, "An attached file is too large.")
    .transform(cleanText)
    .refine((text) => text.trim().length > 0, "An attached file is empty."),
});
