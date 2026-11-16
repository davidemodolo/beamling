"use client";

import { useState, type ReactNode } from "react";
import { isSafeHttpUrl } from "@/lib/url";
import { Icon } from "../ui/icon";
import { Modal } from "../ui/modal";

interface AnswerImageProps {
  sourceId: string;
  caption: string;
  sourceTitle: string;
  sourceUrl: string;
  /** The citation chip for the source. */
  cite: ReactNode;
}

/**
 * A picture from one of the answer's sources, loaded through Beamling (never from its host). Spans,
 * not a figure, so it can sit inside a paragraph. Hidden entirely when the picture cannot load.
 */
export function AnswerImage({ sourceId, caption, sourceTitle, sourceUrl, cite }: AnswerImageProps) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (failed) return null;
  const src = `/api/sources/${encodeURIComponent(sourceId)}/image`;
  const label = caption || sourceTitle;
  return (
    <span className="answer-image" role="figure" aria-label={label}>
      <button type="button" className="answer-image-open" onClick={() => setOpen(true)} aria-label={`Enlarge picture: ${label}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by Beamling's own route, not an optimizable asset */}
        <img src={src} alt={label} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </button>
      <span className="answer-image-caption">
        {label} {cite}
      </span>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        width={900}
        footer={
          isSafeHttpUrl(sourceUrl) ? (
            <a className="btn btn-secondary btn-sm" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={13} /> Open source page
            </a>
          ) : null
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by Beamling's own route, not an optimizable asset */}
        <img className="answer-image-large" src={src} alt={label} referrerPolicy="no-referrer" />
      </Modal>
    </span>
  );
}
