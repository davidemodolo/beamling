"use client";

import { useState } from "react";
import {
  CONVERSATION_RETENTION_DAYS,
  MAX_CONVERSATIONS,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS_PER_CONVERSATION,
  QUESTIONS_PER_DAY,
  QUESTIONS_PER_HOUR,
  STORAGE_LIMIT_BYTES,
  STORAGE_WARNING_RATIO,
} from "@/lib/legal";
import { IMAGE_RETENTION_DAYS, MAX_FILE_BYTES, MAX_FILES_PER_QUESTION, MAX_IMAGES_PER_QUESTION } from "@/lib/attachments";
import { useAccount } from "@/lib/store";
import type { UsageReport } from "@/lib/types";
import { formatBytes, formatNumber } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { StorageChats } from "./storage-chats";
import { Icon } from "./ui/icon";
import { UserAvatar } from "./user-avatar";

function Meter({
  label,
  used,
  limit,
  display,
  note,
  children,
}: {
  label: string;
  used: number;
  limit: number;
  display: string;
  note: string;
  children?: React.ReactNode;
}) {
  const ratio = Math.min(1, used / limit);
  const tone = ratio >= 1 ? "full" : ratio >= STORAGE_WARNING_RATIO ? "warn" : "";
  return (
    <div className={`limit-meter ${tone}`}>
      <div className="limit-meter-head">
        <strong>{label}</strong>
        <span className="mono">{display}</span>
      </div>
      <div
        className="limit-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={display}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <p>{note}</p>
      {children}
    </div>
  );
}

export function LimitsView({ usage }: { usage: UsageReport }) {
  const { user } = useAccount();
  const { openSidebar, openSettings } = useSidebar();
  const storageFull = usage.storageBytes >= STORAGE_LIMIT_BYTES;
  const [managing, setManaging] = useState(false);

  return (
    <main className="main-pane" id="main">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={openSidebar} aria-label="Open conversations">
          <Icon name="menu" size={18} />
        </button>
        <div className="topbar-title">
          <strong>Limits</strong>
          <span>Your usage, visible only to you</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="avatar-button" onClick={() => openSettings()} aria-label="Open settings">
            <UserAvatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} />
          </button>
        </div>
      </header>

      <div className="limits-scroll" tabIndex={0} role="region" aria-label="Limits and usage">
        <div className="limits">
          {storageFull ? (
            <div className="notice notice-error" role="status">
              <Icon name="alert" size={16} />
              <div>
                <strong>Storage full</strong>
                Delete some chats to keep asking.
              </div>
            </div>
          ) : null}

          <section>
            <h2>Usage</h2>
            <Meter
              label="Storage"
              used={usage.storageBytes}
              limit={STORAGE_LIMIT_BYTES}
              display={`${formatBytes(usage.storageBytes)} of ${formatBytes(STORAGE_LIMIT_BYTES)}`}
              note="Chats, answers and sources, encrypted. New questions stop when full."
            >
              <button
                type="button"
                className="btn btn-secondary btn-sm limit-meter-action"
                onClick={() => setManaging((open) => !open)}
                aria-expanded={managing}
                aria-controls="storage-chats"
              >
                <Icon name={managing ? "x" : "trash"} size={12} /> {managing ? "Close" : "Free up space"}
              </button>
              <div id="storage-chats" hidden={!managing}>
                {managing ? <StorageChats chats={usage.chats} /> : null}
              </div>
            </Meter>
            <Meter
              label="Chats"
              used={usage.conversations}
              limit={MAX_CONVERSATIONS}
              display={`${usage.conversations} of ${MAX_CONVERSATIONS}`}
              note="New chats replace the oldest unpinned ones."
            />
            <Meter
              label="Questions this hour"
              used={usage.questionsThisHour}
              limit={QUESTIONS_PER_HOUR}
              display={`${usage.questionsThisHour} of ${QUESTIONS_PER_HOUR}`}
              note="Resets an hour after the first question in the window."
            />
            <Meter
              label="Questions today"
              used={usage.questionsToday}
              limit={QUESTIONS_PER_DAY}
              display={`${usage.questionsToday} of ${QUESTIONS_PER_DAY}`}
              note="Resets a day after the first question in the window."
            />
          </section>

          <section>
            <h2>Rules</h2>
            <ul className="limits-rules">
              <li>{MAX_QUESTIONS_PER_CONVERSATION} questions per chat, then start a new one.</li>
              <li>{formatNumber(MAX_QUESTION_CHARS)} characters per question.</li>
              <li>
                {MAX_IMAGES_PER_QUESTION} images and {MAX_FILES_PER_QUESTION} text files (.md or .txt, {MAX_FILE_BYTES / 1000} KB each) per
                question. They stay only in this browser, for {IMAGE_RETENTION_DAYS} days.
              </li>
              <li>Chats are deleted {CONVERSATION_RETENTION_DAYS} days after their last question.</li>
              <li>The model sees the last few messages of a chat, not all of it.</li>
            </ul>
          </section>

          <section>
            <h2>Privacy</h2>
            <p>
              Only you can see this page. Your chats stay encrypted with your account&apos;s own key; usage is measured from
              their stored size, and nothing new is kept.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
