"use client";

import { useState } from "react";

function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "googleusercontent.com" && !url.hostname.endsWith(".googleusercontent.com")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function UserAvatar({
  name,
  email,
  avatarUrl,
  size,
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : safeAvatarUrl(avatarUrl);
  const initial = (name || email || "?").slice(0, 1).toUpperCase();
  return (
    <span className="avatar" style={size ? { width: size, height: size, fontSize: size / 3.4 } : undefined}>
      {src ? (
        // The avatar is a small third-party image; Next image optimization is disabled in this app.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size ?? 30} height={size ?? 30} onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </span>
  );
}
