interface ActiveChat {
  userId: string;
  controller: AbortController;
}

const active = new Map<string, ActiveChat>();

export function registerChat(messageId: string, userId: string, controller: AbortController): void {
  active.set(messageId, { userId, controller });
}

export function unregisterChat(messageId: string): void {
  active.delete(messageId);
}

export function stopChat(userId: string, messageId: string): boolean {
  const entry = active.get(messageId);
  if (!entry || entry.userId !== userId) return false;
  entry.controller.abort();
  return true;
}
