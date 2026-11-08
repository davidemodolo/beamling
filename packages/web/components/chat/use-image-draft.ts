"use client";

import { useCallback, useRef, useState } from "react";
import { MAX_IMAGES_PER_QUESTION } from "@/lib/attachments";
import { ImageError, prepareImage, type PreparedImage } from "@/lib/images";

/** The images picked for the next question: added from a file picker, paste or drop, resized on the device. */
export function useImageDraft(onError: (message: string) => void) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [adding, setAdding] = useState(0);
  // Picked and being resized, counted at once so quick successive adds see each other.
  const taken = useRef(0);

  const add = useCallback(
    async (files: File[]) => {
      const picked = files.filter((file) => file.type.startsWith("image/"));
      if (files.length && !picked.length) return onError("Only images can be attached.");
      const room = MAX_IMAGES_PER_QUESTION - taken.current;
      if (picked.length > room) onError(`Attach at most ${MAX_IMAGES_PER_QUESTION} images per question.`);
      const accepted = picked.slice(0, Math.max(0, room));
      if (!accepted.length) return;
      taken.current += accepted.length;
      setAdding((count) => count + accepted.length);
      const results = await Promise.allSettled(accepted.map(prepareImage));
      setAdding((count) => count - accepted.length);
      const ready = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      taken.current -= accepted.length - ready.length;
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) onError(failed.reason instanceof ImageError ? failed.reason.message : "This image could not be attached.");
      setImages((current) => [...current, ...ready]);
    },
    [onError],
  );

  // Only shown images can be removed, so each removal frees one place.
  const remove = useCallback((id: string) => {
    taken.current = Math.max(0, taken.current - 1);
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);
  const clear = useCallback(() => {
    taken.current = 0;
    setImages([]);
  }, []);

  return { images, adding: adding > 0, add, remove, clear, full: images.length + adding >= MAX_IMAGES_PER_QUESTION };
}
