"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./ui/icon";
import type { PreparedImage } from "@/lib/images";

function Preview({ image, index, onRemove }: { image: PreparedImage; index: number; onRemove: (id: string) => void }) {
  const ref = useRef<HTMLImageElement>(null);
  // The URL lives exactly as long as the preview shows this blob.
  useEffect(() => {
    const url = URL.createObjectURL(image.blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image.blob]);
  return (
    <li className="composer-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimizable asset */}
      <img ref={ref} alt={`Attached image ${index + 1}`} />
      <button type="button" onClick={() => onRemove(image.id)} aria-label={`Remove image ${index + 1}`}>
        <Icon name="x" size={11} />
      </button>
    </li>
  );
}

/** The images picked for the next question, each removable. */
export function ComposerImages({ images, adding, onRemove }: { images: PreparedImage[]; adding: boolean; onRemove: (id: string) => void }) {
  if (!images.length && !adding) return null;
  return (
    <ul className="composer-images" aria-label="Attached images">
      {images.map((image, index) => (
        <Preview key={image.id} image={image} index={index} onRemove={onRemove} />
      ))}
      {adding ? (
        <li className="composer-image composer-image-loading" aria-label="Preparing image">
          <Icon name="loader" size={14} className="spin" />
        </li>
      ) : null}
    </ul>
  );
}
