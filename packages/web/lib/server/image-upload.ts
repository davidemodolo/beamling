import { z } from "zod";
import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES, type ImageMediaType, type ImageUpload } from "../attachments";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** File signatures: the declared type must match the bytes, so nothing else reaches a model. */
const SIGNATURES: Record<ImageMediaType, (bytes: Buffer) => boolean> = {
  "image/jpeg": (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (bytes) => bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP",
};

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
