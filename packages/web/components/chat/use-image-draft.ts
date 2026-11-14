"use client";

import { useCallback, useRef, useState } from "react";
import { MAX_FILES_PER_QUESTION, MAX_IMAGES_PER_QUESTION } from "@/lib/attachments";
import { ImageError, isTextFile, prepareImage, prepareTextFile, type PreparedFile, type PreparedImage } from "@/lib/images";

/**
 * The images and text files picked for the next question: added from a file picker, paste or drop,
 * and prepared on the device (images are resized, text files are read).
 */
export function useImageDraft(onError: (message: string) => void) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [adding, setAdding] = useState(0);
  // Picked and being prepared, counted at once so quick successive adds see each other.
  const taken = useRef({ images: 0, files: 0 });

  const add = useCallback(
    async (picked: File[]) => {
      const pickedImages = picked.filter((file) => file.type.startsWith("image/"));
      const pickedFiles = picked.filter((file) => !file.type.startsWith("image/") && isTextFile(file));
      if (picked.length > pickedImages.length + pickedFiles.length) onError("Only images and .md or .txt files can be attached.");
      const imageRoom = MAX_IMAGES_PER_QUESTION - taken.current.images;
      const fileRoom = MAX_FILES_PER_QUESTION - taken.current.files;
      if (pickedImages.length > imageRoom) onError(`Attach at most ${MAX_IMAGES_PER_QUESTION} images per question.`);
      if (pickedFiles.length > fileRoom) onError(`Attach at most ${MAX_FILES_PER_QUESTION} text files per question.`);
      const acceptedImages = pickedImages.slice(0, Math.max(0, imageRoom));
      const acceptedFiles = pickedFiles.slice(0, Math.max(0, fileRoom));
      const count = acceptedImages.length + acceptedFiles.length;
      if (!count) return;
      taken.current.images += acceptedImages.length;
      taken.current.files += acceptedFiles.length;
      setAdding((current) => current + count);
      const [imageResults, fileResults] = await Promise.all([
        Promise.allSettled(acceptedImages.map(prepareImage)),
        Promise.allSettled(acceptedFiles.map(prepareTextFile)),
      ]);
      setAdding((current) => current - count);
      const ready = <T,>(results: PromiseSettledResult<T>[]) =>
        results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const readyImages = ready(imageResults);
      const readyFiles = ready(fileResults);
      taken.current.images -= acceptedImages.length - readyImages.length;
      taken.current.files -= acceptedFiles.length - readyFiles.length;
      const failed = [...imageResults, ...fileResults].find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) onError(failed.reason instanceof ImageError ? failed.reason.message : "This file could not be attached.");
      if (readyImages.length) setImages((current) => [...current, ...readyImages]);
      if (readyFiles.length) setFiles((current) => [...current, ...readyFiles]);
    },
    [onError],
  );

  // Only shown attachments can be removed, so each removal frees one place.
  const remove = useCallback((id: string) => {
    setImages((current) => {
      const next = current.filter((image) => image.id !== id);
      taken.current.images = Math.max(0, taken.current.images - (current.length - next.length));
      return next;
    });
    setFiles((current) => {
      const next = current.filter((file) => file.id !== id);
      taken.current.files = Math.max(0, taken.current.files - (current.length - next.length));
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    taken.current = { images: 0, files: 0 };
    setImages([]);
    setFiles([]);
  }, []);

  return { images, files, adding: adding > 0, add, remove, clear };
}
