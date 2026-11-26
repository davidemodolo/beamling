"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { StorageChat } from "@/lib/types";
import { formatBytes, plural } from "@/lib/utils";
import { DeleteChatsDialog, useChatSelection, useDeleteChats } from "./history-selection";
import { Icon } from "./ui/icon";

type Order = "suggested" | "size";

const DAY_MS = 86_400_000;

/** Whole days since the chat's last activity. */
function idleDays(chat: StorageChat, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(chat.updatedAt)) / DAY_MS));
}

/**
 * Suggested order: size weighted by idleness, so a chat untouched for 30 days counts double and one
 * used today still ranks by size alone. Pinned chats go last.
 */
function sortChats(chats: StorageChat[], order: Order, now: number): StorageChat[] {
  if (order === "size") return [...chats].sort((a, b) => b.bytes - a.bytes);
  const score = (chat: StorageChat) => chat.bytes * (1 + idleDays(chat, now) / 30);
  return [...chats].sort((a, b) => Number(a.pinned) - Number(b.pinned) || score(b) - score(a));
}

function lastUsed(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The account's chats with their stored size, to pick and delete the ones taking space. */
export function StorageChats({ chats }: { chats: StorageChat[] }) {
  const router = useRouter();
  const deletion = useDeleteChats<StorageChat>();
  const [order, setOrder] = useState<Order>("suggested");
  // Read once when the list opens; it is rendered only on the client.
  const [now] = useState(() => Date.now());
  const sorted = useMemo(() => sortChats(chats, order, now), [chats, order, now]);
  const selection = useChatSelection(sorted);
  const chosenBytes = selection.chosen.reduce((sum, chat) => sum + chat.bytes, 0);

  const confirmDelete = async () => {
    if (await deletion.confirm()) selection.start();
    router.refresh();
  };

  if (!chats.length) return <p className="storage-chats-empty">No chats stored.</p>;

  return (
    <div className="storage-chats">
      <div className="storage-chats-head">
        <span>Sort by</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOrder("suggested")}
          aria-pressed={order === "suggested"}
          title="Large chats you have not used for a while come first"
        >
          Size and age
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOrder("size")}
          aria-pressed={order === "size"}
        >
          Size
        </button>
      </div>

      <ul className="storage-chats-list">
        {sorted.map((chat) => (
          <li key={chat.id} className={selection.isChosen(chat.id) ? "is-selected" : undefined}>
            <input
              type="checkbox"
              checked={selection.isChosen(chat.id)}
              onChange={() => selection.toggle(chat.id)}
              aria-label={`Select ${chat.title}`}
            />
            <div>
              <Link href={`/chat/${chat.id}`}>
                {chat.pinned ? <Icon name="pin" size={11} /> : null} {chat.title}
              </Link>
              <span className="mono">
                {formatBytes(chat.bytes)} · {lastUsed(idleDays(chat, now))} · {plural(chat.questions, "question")}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {deletion.failed ? (
        <p className="storage-chats-error" role="alert">
          Could not delete the chats. Try again.
        </p>
      ) : null}

      <div className="storage-chats-foot" role="toolbar" aria-label="Selected chats">
        <label className="history-select-all">
          <input type="checkbox" checked={selection.allChosen} onChange={selection.toggleAll} />
          {selection.chosen.length ? `${selection.chosen.length} selected, ${formatBytes(chosenBytes)}` : "Select all"}
        </label>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={!selection.chosen.length}
          onClick={() => deletion.ask(selection.chosen)}
        >
          <Icon name="trash" size={12} /> Delete
        </button>
      </div>

      <DeleteChatsDialog chats={deletion.deleting} onClose={deletion.cancel} onConfirm={confirmDelete} />
    </div>
  );
}
