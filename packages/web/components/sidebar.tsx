"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState, type Ref } from "react";
import { CONVERSATION_RETENTION_DAYS, CONVERSATION_WARNING_THRESHOLD, MAX_CONVERSATIONS } from "@/lib/legal";
import { useAccount, useConversations } from "@/lib/store";
import type { ConversationSummary } from "@/lib/types";
import { dayGroup } from "@/lib/utils";
import { versionLabel } from "@/lib/version";
import { useSidebar } from "./sidebar-context";
import { Icon } from "./ui/icon";
import { Modal } from "./ui/modal";
import { Wordmark } from "./wordmark";

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

function SidebarContent({ mobile, onNavigate }: SidebarProps) {
  const { user, signOut, ready, error, refresh } = useAccount();
  const { conversations, conversationCount, hasMoreConversations, loadMoreConversations, deleteConversation, setConversationPinned } = useConversations();
  const { openSettings } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const loadMore = async () => {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      await loadMoreConversations();
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const activeId = pathname.startsWith("/chat/") ? decodeURIComponent(pathname.slice(6)) : null;

  const term = deferredSearch.trim().toLocaleLowerCase();
  const groups = useMemo(() => {
    const matched = term
      ? conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(term))
      : conversations;
    const sorted = matched
      .slice()
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      );
    if (term) return sorted.length ? [{ label: "Results" as const, items: sorted }] : [];

    const pinned = sorted.filter((conversation) => conversation.pinned);
    const recent = sorted.filter((conversation) => !conversation.pinned);
    const order: ("Today" | "Yesterday" | "Previous")[] = ["Today", "Yesterday", "Previous"];
    return [
      { label: "Pinned" as const, items: pinned },
      ...order.map((label) => ({
        label,
        items: recent.filter((conversation) => dayGroup(conversation.updatedAt) === label),
      })),
    ].filter((group) => group.items.length);
  }, [conversations, term]);

  const close = () => onNavigate?.();

  return (
    <>
      <div className="sidebar-top">
        <Wordmark href="/" onClick={close} />
        {mobile ? (
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close menu">
            <Icon name="x" size={17} />
          </button>
        ) : null}
      </div>

      <Link href="/" className="btn btn-secondary sidebar-new" onClick={close}>
        <span className="plus-box">
          <Icon name="plus" size={14} />
        </span>
        New question
      </Link>

      <div className="sidebar-search-wrap">
        <div className="sidebar-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            autoComplete="off"
            spellCheck={false}
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        {term && hasMoreConversations ? (
          <p className="sidebar-search-note">Searching loaded chats. Load older chats to widen the search.</p>
        ) : null}
      </div>

      <div className="sidebar-scroll">
        {error ? (
          <div className="sidebar-error" role="status">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : null}
        {!ready ? (
          <div className="sidebar-skeleton" aria-label="Loading conversations" aria-busy="true">
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} />
            ))}
          </div>
        ) : groups.length ? (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="history-group">{group.label}</h2>
              {group.items.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`history-item${conversation.pinned ? " is-pinned" : ""}`}
                  aria-current={activeId === conversation.id ? "page" : undefined}
                >
                  {conversation.pinned ? (
                    <span className="history-pin-mark" title="Pinned" aria-hidden="true">
                      <Icon name="pin" size={11} />
                    </span>
                  ) : null}
                  <Link href={`/chat/${conversation.id}`} className="history-title" onClick={close}>
                    {conversation.title}
                  </Link>
                  <div className="history-actions">
                    <button
                      type="button"
                      aria-label={`${conversation.pinned ? "Unpin" : "Pin"} ${conversation.title}`}
                      title={conversation.pinned ? "Unpin" : "Pin"}
                      onClick={() => setConversationPinned(conversation.id, !conversation.pinned)}
                    >
                      <Icon name="pin" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => setDeleting(conversation)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ))
        ) : (
          <p className="history-empty">
            {term ? `No chats match “${deferredSearch.trim()}”.` : "No conversations yet."}
          </p>
        )}
        {hasMoreConversations ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm history-more"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? <Icon name="loader" size={13} className="spin" /> : null}
            {loadMoreFailed
              ? "Could not load. Try again"
              : term
                ? "Load older chats"
                : "Show older conversations"}
          </button>
        ) : null}
        {ready && !error ? (
          <p
            className={`history-retention${conversationCount >= CONVERSATION_WARNING_THRESHOLD ? " warn" : ""}`}
            role={conversationCount >= CONVERSATION_WARNING_THRESHOLD ? "status" : undefined}
          >
            {conversationCount >= CONVERSATION_WARNING_THRESHOLD
              ? `${Math.min(conversationCount, MAX_CONVERSATIONS)} of ${MAX_CONVERSATIONS} chats. New chats replace the oldest unpinned ones. `
              : null}
            Chats are deleted {CONVERSATION_RETENTION_DAYS} days after their last message.
          </p>
        ) : null}
      </div>

      <div className="sidebar-foot">
        <Link href="/limits" className="side-link" onClick={close}>
          <Icon name="chart" size={15} /> Limits
        </Link>
        <button
          type="button"
          className="side-link"
          style={{ width: "100%", background: "none", border: 0, textAlign: "left" }}
          onClick={() => {
            close();
            openSettings();
          }}
        >
          <Icon name="settings" size={15} /> Settings
        </button>
        <button
          type="button"
          className="side-link"
          style={{ width: "100%", background: "none", border: 0, textAlign: "left" }}
          onClick={() => void signOut()}
        >
          <Icon name="arrow-right" size={15} /> Sign out
        </button>
        <div className="side-link" style={{ fontSize: 10.5, color: "var(--muted-2)", height: "auto", padding: "8px 9px 4px", lineHeight: 1.4 }}>
          <Icon name="lock" size={12} />
          {user?.email ?? "Signed in"} · keys stay on the server.
        </div>
        <div className="sidebar-version">{versionLabel()}</div>
      </div>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete conversation"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (!deleting) return;
                const wasActive = activeId === deleting.id;
                deleteConversation(deleting.id);
                setDeleting(null);
                close();
                if (wasActive) router.push("/");
              }}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
          “{deleting?.title}” and all of its messages and sources will be deleted. This cannot be undone.
        </p>
      </Modal>
    </>
  );
}

export function Sidebar({ mobile, onNavigate, ref }: SidebarProps & { ref?: Ref<HTMLElement> }) {
  return (
    <aside
      ref={ref}
      className={mobile ? "drawer" : "sidebar"}
      aria-label="Conversations"
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile ? true : undefined}
    >
      <SidebarContent mobile={mobile} onNavigate={onNavigate} />
    </aside>
  );
}
