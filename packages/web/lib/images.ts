"use client";

import { IMAGE_MAX_EDGE, MAX_IMAGE_BYTES, type ImageMediaType } from "./attachments";

/** A picked image after resizing, ready to show, keep on the device and send. */
export interface PreparedImage {
  id: string;
  blob: Blob;
  mediaType: ImageMediaType;
}

export class ImageError extends Error {}

// Smaller and smaller until the image fits MAX_IMAGE_BYTES.
const ATTEMPTS = [
  { edge: IMAGE_MAX_EDGE, quality: 0.85 },
  { edge: IMAGE_MAX_EDGE, quality: 0.7 },
  { edge: 1024, quality: 0.7 },
  { edge: 768, quality: 0.6 },
];

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Decodes any image the browser can read, scales it to at most IMAGE_MAX_EDGE on the long side and
 * re-encodes it as WebP (JPEG where WebP encoding is missing). Re-encoding also drops metadata such
 * as the location a photo was taken.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError("This image could not be read. Try a JPEG, PNG or WebP.");
  }
  try {
    for (const { edge, quality } of ATTEMPTS) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob = await encode(canvas, "image/webp", quality);
      if (blob?.type !== "image/webp") {
        // JPEG has no transparency: paint transparent areas white rather than black.
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        blob = await encode(canvas, "image/jpeg", quality);
      }
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        return { id: crypto.randomUUID(), blob, mediaType: blob.type === "image/webp" ? "image/webp" : "image/jpeg" };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new ImageError("This image is too large to attach.");
}

/** Base64 of a blob, without the data URL prefix. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
