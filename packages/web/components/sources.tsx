"use client";

import { Icon } from "./ui/icon";
import { Mascot } from "./mascot";
import type { Source } from "@/lib/types";
import { shortDate } from "@/lib/utils";

interface SourceListProps {
  sources: Source[];
  active: number | null;
  loading?: boolean;
  onSelect?: (position: number) => void;
}

function SourceCard({ source, active, onSelect }: { source: Source; active: boolean; onSelect?: (position: number) => void }) {
  return (
    <a
      id={`source-${source.position}`}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`source-card ${active ? "is-active" : ""}`}
      onMouseEnter={() => onSelect?.(source.position)}
      onFocus={() => onSelect?.(source.position)}
      aria-label={`Source ${source.position}: ${source.title} — ${source.domain}`}
    >
      <div className="source-top">
        <span className="source-num">{String(source.position).padStart(2, "0")}</span>
        <span className="fav" aria-hidden="true">
          {source.domain.slice(0, 1)}
        </span>
        <span className="source-domain">{source.domain}</span>
        <span className="source-ext" aria-hidden="true">
          <Icon name="external" size={12} />
        </span>
      </div>
      <div className="source-title">{source.title}</div>
      <div className="source-snippet">{source.snippet}</div>
      {source.publishedAt ? (
        <div className="source-date">
          <Icon name="clock" size={11} />
          {shortDate(source.publishedAt)}
        </div>
      ) : null}
    </a>
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

export function SourcesPanel({ sources, active, loading, onSelect, provider, onClose }: SourcesPanelProps) {
  return (
    <aside className="sources-pane" aria-label="Sources">
      <div className="sources-head">
        <h2>
          Sources <span className="count">{sources.length}</span>
        </h2>
        <span className="badge badge-mono">{provider}</span>
        <span className="spacer" />
        {onClose ? (
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Hide sources">
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>
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
  if (!open) return null;
  return (
    <>
      <button type="button" className="overlay" onClick={onClose} aria-label="Close sources" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Sources, ${sources.length}`}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sources-head">
          <h2>
            Sources <span className="count">{sources.length}</span>
          </h2>
          <span className="badge badge-mono">{provider}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close sources">
            <Icon name="x" size={15} />
          </button>
        </div>
        <SourceList sources={sources} active={active} loading={loading} onSelect={onSelect} />
      </div>
    </>
  );
}
