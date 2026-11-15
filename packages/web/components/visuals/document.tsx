"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { documentFileName, type AnswerDocument } from "@/lib/visuals";
import { Markdown } from "../markdown";
import { Icon } from "../ui/icon";
import { CodeBlock, CopyButton } from "./code-block";

/** What the panel shows: a document plus how to resolve its citations. */
export interface OpenDocument extends AnswerDocument {
  key: string;
  citations: number;
  allowedLinks?: readonly string[];
  onCitation?: (position: number) => void;
}

interface DocumentPanel {
  current: OpenDocument | null;
  open: (doc: OpenDocument) => void;
  /** Refreshes the open document while it is still being written. */
  update: (doc: OpenDocument) => void;
  /** Desktop only: a document being written opens the panel by itself. */
  autoOpen: boolean;
}

const DocumentPanelContext = createContext<DocumentPanel | null>(null);
export const DocumentPanelProvider = DocumentPanelContext.Provider;

/** The card in the chat for a <document> block. Without a panel (reasoning, previews) it renders inline. */
export function DocumentCard({ doc }: { doc: OpenDocument }) {
  const panel = useContext(DocumentPanelContext);
  const isOpen = panel?.current?.key === doc.key;
  const opened = useRef(false);

  useEffect(() => {
    if (!panel) return;
    if (panel.current?.key === doc.key) {
      if (panel.current.markdown !== doc.markdown || panel.current.open !== doc.open) panel.update(doc);
    } else if (doc.open && panel.autoOpen && !opened.current) {
      panel.open(doc);
    }
    opened.current = true;
  }, [panel, doc]);

  if (!panel) {
    return (
      <div className="document-inline">
        <h3>{doc.title}</h3>
        <Markdown text={doc.markdown} citations={doc.citations} allowedLinks={doc.allowedLinks} />
      </div>
    );
  }
  return (
    <button type="button" className={`document-card${isOpen ? " active" : ""}`} onClick={() => panel.open(doc)} aria-pressed={isOpen}>
      <span className="document-icon" aria-hidden="true">
        <Icon name={doc.open ? "loader" : "file"} size={16} className={doc.open ? "spin" : undefined} />
      </span>
      <span className="document-text">
        <strong>{doc.title}</strong>
        <span>{doc.open ? "Writing document…" : isOpen ? "Open in the panel" : "Document · open"}</span>
      </span>
    </button>
  );
}

function download(doc: OpenDocument) {
  const url = URL.createObjectURL(new Blob([`# ${doc.title}\n\n${doc.markdown.trim()}\n`], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = documentFileName(doc.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DocumentBody({ doc, onClose, closeLabel }: { doc: OpenDocument; onClose: () => void; closeLabel: string }) {
  const [source, setSource] = useState(false);
  return (
    <>
      <div className="document-head">
        <h2 title={doc.title}>{doc.title}</h2>
        <span className="spacer" />
        <button type="button" className={`btn btn-ghost btn-sm${source ? " active" : ""}`} onClick={() => setSource(!source)} aria-pressed={source}>
          {source ? "Preview" : "Markdown"}
        </button>
        <CopyButton text={doc.markdown.trim()} label="Copy document" />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => download(doc)} aria-label="Download as Markdown" title="Download .md" disabled={doc.open}>
          <Icon name="download" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={closeLabel}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="document-scroll">
        {source ? (
          <CodeBlock code={doc.markdown.trim()} language="markdown" closed={!doc.open} />
        ) : (
          <div className="document-page">
            <Markdown text={doc.markdown} citations={doc.citations} onCitation={doc.onCitation} streaming={doc.open} allowedLinks={doc.allowedLinks} />
          </div>
        )}
      </div>
    </>
  );
}

/** The document beside the chat (desktop) or as a full-height sheet (phone). */
export function DocumentPane({ doc, onClose, sheet }: { doc: OpenDocument; onClose: () => void; sheet: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, sheet, onClose);
  if (sheet) {
    return (
      <>
        <button type="button" className="overlay" onClick={onClose} aria-label="Close document" tabIndex={-1} />
        <div ref={ref} className="sheet document-sheet" role="dialog" aria-modal="true" aria-label={doc.title}>
          <div className="sheet-handle" aria-hidden="true" />
          <DocumentBody doc={doc} onClose={onClose} closeLabel="Close document" />
        </div>
      </>
    );
  }
  return (
    <aside className="document-pane" aria-label={`Document: ${doc.title}`}>
      <DocumentBody doc={doc} onClose={onClose} closeLabel="Hide document" />
    </aside>
  );
}
