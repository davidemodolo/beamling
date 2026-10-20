"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { dayGroup } from "@/lib/utils";
import { useSidebar } from "./chat-shell";
import { Icon } from "./ui/icon";
import { Modal } from "./ui/modal";
import { Wordmark } from "./wordmark";

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

function SidebarContent({ mobile, onNavigate }: SidebarProps) {
  const { conversations, deleteConversation } = useStore();
  const { openSettings } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const activeId = pathname.startsWith("/chat/") ? decodeURIComponent(pathname.slice(6)) : null;

  const groups = useMemo(() => {
    const filtered = conversations
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const order: ("Today" | "Yesterday" | "Previous")[] = ["Today", "Yesterday", "Previous"];
    return order
      .map((label) => ({ label, items: filtered.filter((conversation) => dayGroup(conversation.updatedAt) === label) }))
      .filter((group) => group.items.length);
  }, [conversations]);

  const close = () => onNavigate?.();

  return (
    <>
      <div className="sidebar-top">
        <Wordmark href="/chat" onClick={close} />
        {mobile ? (
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close menu">
            <Icon name="x" size={17} />
          </button>
        ) : null}
      </div>

      <Link href="/chat" className="btn btn-secondary sidebar-new" onClick={close}>
        <span className="plus-box">
          <Icon name="plus" size={14} />
        </span>
        New question
      </Link>

      <div className="sidebar-scroll">
        {groups.length ? (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="history-group">{group.label}</h2>
              {group.items.map((conversation) => (
                <div
                  key={conversation.id}
                  className="history-item"
                  aria-current={activeId === conversation.id ? "page" : undefined}
                >
                  <Link href={`/chat/${conversation.id}`} className="history-title" onClick={close}>
                    {conversation.title}
                  </Link>
                  <div className="history-actions">
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
          <p className="history-empty">No conversations yet.</p>
        )}
      </div>

      <div className="sidebar-foot">
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
        <div className="side-link" style={{ fontSize: 10.5, color: "var(--muted-2)", height: "auto", padding: "8px 9px 4px", lineHeight: 1.4 }}>
          <Icon name="lock" size={12} />
          Guest workspace. Data is stored on the server.
        </div>
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
                if (wasActive) router.push("/chat");
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

export function Sidebar({ mobile, onNavigate }: SidebarProps) {
  return (
    <aside className={mobile ? "drawer" : "sidebar"} aria-label="Conversations">
      <SidebarContent mobile={mobile} onNavigate={onNavigate} />
    </aside>
  );
}
