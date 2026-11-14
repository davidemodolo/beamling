"use client";

import { IMAGE_MAX_EDGE, isTextFileName, MAX_FILE_BYTES, MAX_FILE_NAME_CHARS, MAX_IMAGE_BYTES, type ImageMediaType } from "./attachments";

/** A picked image after resizing, ready to show, keep on the device and send. */
export interface PreparedImage {
  id: string;
  blob: Blob;
  mediaType: ImageMediaType;
}

/** A picked text file, read on the device, ready to show, keep and send. */
export interface PreparedFile {
  id: string;
  name: string;
  text: string;
}

export class ImageError extends Error {}

export const isTextFile = (file: File): boolean =>
  isTextFileName(file.name) && (!file.type || file.type.startsWith("text/"));

/** Reads a .md or .txt file as UTF-8. Empty, oversized and binary files are refused. */
export async function prepareTextFile(file: File): Promise<PreparedFile> {
  if (file.size > MAX_FILE_BYTES) throw new ImageError(`Text files are limited to ${MAX_FILE_BYTES / 1000} KB.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new ImageError("This file is not plain text.");
  }
  if (text.includes("\u0000")) throw new ImageError("This file is not plain text.");
  if (!text.trim()) throw new ImageError("This file is empty.");
  return { id: crypto.randomUUID(), name: file.name.slice(-MAX_FILE_NAME_CHARS), text };
}

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
