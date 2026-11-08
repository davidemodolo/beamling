"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { Icon } from "./icon";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width = 440 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // Rendered at the body: an ancestor with a transform or backdrop filter (the sidebar) would
  // otherwise become the containing block and clip the fixed dialog.
  return createPortal(
    <>
      <button type="button" className="overlay" aria-label="Close dialog" onClick={onClose} />
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </>,
    document.body,
  );
}
