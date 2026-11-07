"use client";

import { useRef } from "react";
import { Icon } from "./ui/icon";
import { Mascot } from "./mascot";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import type { Source } from "@/lib/types";
import { isSafeHttpUrl } from "@/lib/url";
import { shortDate } from "@/lib/utils";

interface SourceListProps {
  sources: Source[];
  active: number | null;
  loading?: boolean;
  onSelect?: (position: number) => void;
}

function SourceCard({ source, active, onSelect }: { source: Source; active: boolean; onSelect?: (position: number) => void }) {
  const shared = {
    id: `source-${source.position}`,
    className: `source-card ${active ? "is-active" : ""}`,
    onMouseEnter: () => onSelect?.(source.position),
    onFocus: () => onSelect?.(source.position),
    "aria-label": `Source ${source.position}: ${source.title}, ${source.domain}`,
  };
  // Only http(s) URLs become links; anything else (javascript:, data:, …) is shown as plain text.
  if (!isSafeHttpUrl(source.url)) {
    return (
      <div {...shared}>
        <SourceCardBody source={source} external={false} />
      </div>
    );
  }
  return (
    <a {...shared} href={source.url} target="_blank" rel="noopener noreferrer">
      <SourceCardBody source={source} external />
    </a>
  );
}

function SourceCardBody({ source, external }: { source: Source; external: boolean }) {
  return (
    <>
      <div className="source-top">
        <span className="source-num">{String(source.position).padStart(2, "0")}</span>
        <span className="fav" aria-hidden="true">
          {source.domain.slice(0, 1)}
        </span>
        <span className="source-domain">{source.domain}</span>
        {external ? (
          <span className="source-ext" aria-hidden="true">
            <Icon name="external" size={12} />
          </span>
        ) : null}
      </div>
      <div className="source-title">{source.title}</div>
      <div className="source-snippet">{source.snippet}</div>
      {source.publishedAt ? (
        <div className="source-date">
          <Icon name="clock" size={11} />
          {shortDate(source.publishedAt)}
        </div>
      ) : null}
    </>
  );
}

function Skeletons() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div className="source-skeleton" key={i} aria-hidden="true">
          <div className="skeleton-line" style={{ width: "44%", height: 9 }} />
          <div className="skeleton-line" style={{ width: "92%", height: 11 }} />
          <div className="skeleton-line" style={{ width: "70%", height: 9 }} />
        </div>
      ))}
    </>
  );
}

function SourceList({ sources, active, loading, onSelect }: SourceListProps) {
  if (!sources.length && !loading) {
    return (
      <div className="sources-empty">
        <div className="mark" aria-hidden="true">
          <Mascot state="empty" beams={false} label="" style={{ width: 64 }} />
        </div>
        <p>Sources appear here as soon as the search returns.</p>
      </div>
    );
  }
  return (
    <div className="sources-list">
      {loading ? <Skeletons /> : null}
      {sources.map((source) => (
        <SourceCard key={source.id} source={source} active={active === source.position} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface SourcesPanelProps extends SourceListProps {
  provider: string;
  onClose?: () => void;
}

function SourcesHeader({
  count,
  provider,
  onClose,
  closeLabel,
}: {
  count: number;
  provider: string;
  onClose?: () => void;
  closeLabel: string;
}) {
  return (
    <div className="sources-head">
      <h2>
        Sources <span className="count">{count}</span>
      </h2>
      <span className="badge badge-mono">{provider}</span>
      <span className="spacer" />
      {onClose ? (
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={closeLabel}>
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function SourcesPanel({ sources, active, loading, onSelect, provider, onClose }: SourcesPanelProps) {
  return (
    <aside className="sources-pane" id="sources-pane" aria-label="Sources">
      <SourcesHeader count={sources.length} provider={provider} onClose={onClose} closeLabel="Hide sources" />
      <SourceList sources={sources} active={active} loading={loading} onSelect={onSelect} />
      <div className="sources-foot">
        <Icon name="shield" size={12} />
        Retrieved with your {provider} key
      </div>
    </aside>
  );
}

export function SourcesSheet({
  open,
  onClose,
  sources,
  active,
  loading,
  onSelect,
  provider,
}: SourcesPanelProps & { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return (
    <>
      <button type="button" className="overlay" onClick={onClose} aria-label="Close sources" tabIndex={-1} />
      <div ref={ref} className="sheet" id="sources-sheet" role="dialog" aria-modal="true" aria-label={`Sources, ${sources.length}`}>
        <div className="sheet-handle" aria-hidden="true" />
        <SourcesHeader count={sources.length} provider={provider} onClose={onClose} closeLabel="Close sources" />
        <SourceList sources={sources} active={active} loading={loading} onSelect={onSelect} />
      </div>
    </>
  );
}
