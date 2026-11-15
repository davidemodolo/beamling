"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { isSafeHttpUrl } from "@/lib/url";
import { citedPositions, documentBody, documentFileName, documentMarkdown, type AnswerDocument, type DocumentSource } from "@/lib/visuals";
import { Markdown } from "../markdown";
import { Icon } from "../ui/icon";
import { CodeBlock, CopyButton } from "./code-block";

/** What the panel shows: a document plus the answer's sources its citations point to. */
export interface OpenDocument extends AnswerDocument {
  key: string;
  sources: readonly DocumentSource[];
  allowedLinks?: readonly string[];
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
    const current = panel.current;
    if (current?.key === doc.key) {
      if (current.markdown !== doc.markdown || current.open !== doc.open || current.sources !== doc.sources) panel.update(doc);
    } else if (doc.open && panel.autoOpen && !opened.current) {
      panel.open(doc);
    }
    opened.current = true;
  }, [panel, doc]);

  if (!panel) {
    return (
      <div className="document-inline">
        <DocumentPage doc={doc} />
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
        <span>{doc.open ? "Writing document…" : isOpen ? "Open beside the chat" : "Document · open"}</span>
      </span>
      <Icon name="panel-right" size={15} className="document-card-go" />
    </button>
  );
}

function download(doc: OpenDocument) {
  const url = URL.createObjectURL(new Blob([documentMarkdown(doc, doc.sources)], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = documentFileName(doc.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The rendered document: title, text with citations linking to their sources, and the cited sources. */
function DocumentPage({ doc }: { doc: OpenDocument }) {
  const body = useMemo(() => documentBody(doc.title, doc.markdown), [doc.title, doc.markdown]);
  const cited = useMemo(() => citedPositions(body, doc.sources).filter((source) => isSafeHttpUrl(source.url)), [body, doc.sources]);
  return (
    <article className="document-page">
      <h1 className="document-title">{doc.title}</h1>
      <Markdown text={body} sources={doc.sources} linkCitations streaming={doc.open} allowedLinks={doc.allowedLinks} />
      {cited.length && !doc.open ? (
        <section className="document-sources" aria-label="Sources">
          <h2>Sources</h2>
          <ol>
            {cited.map((source) => (
              <li key={source.position}>
                <span className="document-source-n">{source.position}</span>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title || domain(source.url)}
                </a>
                <span className="document-source-domain">{domain(source.url)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function DocumentBody({ doc, onClose, closeLabel }: { doc: OpenDocument; onClose: () => void; closeLabel: string }) {
  const [source, setSource] = useState(false);
  const markdown = useMemo(() => documentMarkdown(doc, doc.sources), [doc]);
  return (
    <>
      <div className="document-head">
        <span className="document-kind">
          <Icon name={doc.open ? "loader" : "file"} size={13} className={doc.open ? "spin" : undefined} />
          <span className="document-kind-label">{doc.open ? "Writing document…" : "Document"}</span>
        </span>
        <span className="spacer" />
        <div className="document-tabs" role="group" aria-label="View">
          <button type="button" className={`btn btn-ghost btn-sm${source ? "" : " active"}`} onClick={() => setSource(false)} aria-pressed={!source}>
            Preview
          </button>
          <button type="button" className={`btn btn-ghost btn-sm${source ? " active" : ""}`} onClick={() => setSource(true)} aria-pressed={source}>
            Markdown
          </button>
        </div>
        <CopyButton text={markdown} label="Copy document" />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => download(doc)} aria-label="Download as Markdown" title="Download .md" disabled={doc.open}>
          <Icon name="download" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={closeLabel}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="document-scroll">
        {source ? <CodeBlock code={markdown.trimEnd()} language="markdown" closed={!doc.open} /> : <DocumentPage doc={doc} />}
      </div>
    </>
  );
}

/** The document beside the chat on its right (desktop) or as a full-height sheet (phone). */
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
      <div className="document-frame">
        <DocumentBody doc={doc} onClose={onClose} closeLabel="Hide document" />
      </div>
    </aside>
  );
}
