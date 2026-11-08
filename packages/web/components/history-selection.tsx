"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/types";
import { Icon } from "./ui/icon";
import { Modal } from "./ui/modal";

/**
 * Select mode for the chat list. Only chats on screen count: those hidden by a search are neither
 * selected by "Select all" nor deleted.
 */
export function useChatSelection(visible: ConversationSummary[]) {
  // null when select mode is off.
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  const chosen = ids ? visible.filter((conversation) => ids.has(conversation.id)) : [];
  const allChosen = visible.length > 0 && chosen.length === visible.length;
  return {
    active: !!ids,
    chosen,
    allChosen,
    isChosen: (id: string) => !!ids?.has(id),
    start: () => setIds(new Set()),
    stop: () => setIds(null),
    toggle: (id: string) =>
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    toggleAll: () => setIds(allChosen ? new Set() : new Set(visible.map((conversation) => conversation.id))),
  };
}

export function SelectBar({
  selection,
  onDelete,
}: {
  selection: ReturnType<typeof useChatSelection>;
  onDelete: (conversations: ConversationSummary[]) => void;
}) {
  const count = selection.chosen.length;
  return (
    <div className="history-select-bar" role="toolbar" aria-label="Selected chats">
      <label className="history-select-all">
        <input type="checkbox" checked={selection.allChosen} onChange={selection.toggleAll} />
        {count ? `${count} selected` : "Select all"}
      </label>
      <button type="button" className="btn btn-danger btn-sm" disabled={!count} onClick={() => onDelete(selection.chosen)}>
        <Icon name="trash" size={12} /> Delete
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={selection.stop}>
        Cancel
      </button>
    </div>
  );
}

export function DeleteChatsDialog({
  chats,
  onClose,
  onConfirm,
}: {
  chats: ConversationSummary[] | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const many = !!chats && chats.length > 1;
  return (
    <Modal
      open={!!chats}
      onClose={onClose}
      title={many ? `Delete ${chats.length} chats` : "Delete conversation"}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm}>
            <Icon name="trash" size={13} /> Delete
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
        {many
          ? `These ${chats.length} chats and all of their messages and sources will be deleted.`
          : `“${chats?.[0]?.title ?? ""}” and all of its messages and sources will be deleted.`}{" "}
        This cannot be undone.
      </p>
    </Modal>
  );
}
