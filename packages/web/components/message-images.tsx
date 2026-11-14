"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui/icon";
import { IMAGE_RETENTION_DAYS, isFile, isImage, type FileAttachment, type ImageAttachment } from "@/lib/attachments";
import type { Attachment } from "@/lib/attachments";
import { loadFiles, loadImages } from "@/lib/image-store";

/** One image from this browser, or a placeholder once it expired or when this browser never had it. */
function MessageImage({ attachment, index }: { attachment: ImageAttachment; index: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    void loadImages([attachment.id]).then(([image]) => {
      if (!active) return;
      if (!image) return setMissing(true);
      objectUrl = URL.createObjectURL(image.blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  const label = `Image ${index + 1}`;
  if (url) {
    return (
      <a className="message-image" href={url} target="_blank" rel="noopener noreferrer" title={label}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimizable asset */}
        <img src={url} alt={label} />
      </a>
    );
  }
  return (
    <span
      className="message-image message-image-missing"
      title={missing ? GONE : label}
      role="img"
      aria-label={missing ? `${label}. ${GONE}` : label}
    >
      <Icon name="image" size={18} />
    </span>
  );
}

const GONE = `No longer available. Images and files stay only in the browser they were sent from, for ${IMAGE_RETENTION_DAYS} days.`;

/** A text file's name; dimmed once this browser no longer has its content. */
function MessageFile({ attachment }: { attachment: FileAttachment }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    void loadFiles([attachment.id]).then(([file]) => {
      if (active) setMissing(!file);
    });
    return () => {
      active = false;
    };
  }, [attachment.id]);
  return (
    <span className={`message-file${missing ? " message-file-missing" : ""}`} title={missing ? GONE : attachment.name}>
      <Icon name="file" size={13} />
      <span>{attachment.name}</span>
      {missing ? <span className="sr-only">{GONE}</span> : null}
    </span>
  );
}

export function MessageImages({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter(isImage);
  const files = attachments.filter(isFile);
  return (
    <>
      {images.length ? (
        <div className="message-images">
          {images.map((attachment, index) => (
            <MessageImage key={attachment.id} attachment={attachment} index={index} />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="message-files">
          {files.map((attachment) => (
            <MessageFile key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
    </>
  );
}
