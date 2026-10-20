import { log, summarizeError } from "./log";
import { isStopRequested, requestStop } from "./repo";

const STOP_POLL_MS = 1500;

interface ActiveChat {
  userId: string;
  conversationId: string;
  controller: AbortController;
  /** Settles once the answer's outcome has been stored. */
  done: Promise<void>;
}

const SHUTDOWN = "ShutdownError";

/** Abort reason for answers cut short by a server shutdown. */
export class ShutdownError extends Error {
  constructor() {
    super("The server is shutting down.");
    this.name = SHUTDOWN;
  }
}

/** Checked by name: the shutdown hook and the routes are separate bundles with separate classes. */
export function isShutdown(reason: unknown): boolean {
  return reason instanceof Error && reason.name === SHUTDOWN;
}

// Fast path for stops and deletions that land on the instance running the answer. Other instances
// reach it through the message row, which every running answer polls. Kept on globalThis because
// Next.js bundles route handlers and instrumentation (the shutdown hook) as separate module copies.
const globalForChats = globalThis as unknown as { __beamlingActiveChats?: Map<string, ActiveChat> };
const active = (globalForChats.__beamlingActiveChats ??= new Map<string, ActiveChat>());

/** Registers a running answer and returns the function that unregisters it. */
export function watchChat(
  messageId: string,
  owner: { userId: string; conversationId: string },
  controller: AbortController,
  done: Promise<void>,
): () => void {
  active.set(messageId, { ...owner, controller, done });
  let polling = false;
  const timer = setInterval(() => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    isStopRequested(messageId)
      .then((stop) => {
        if (stop) controller.abort();
      })
      .catch((error) => log.warn("Stop flag check failed", { error: summarizeError(error) }))
      .finally(() => {
        polling = false;
      });
  }, STOP_POLL_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    if (active.get(messageId)?.controller === controller) active.delete(messageId);
  };
}

export async function stopChat(userId: string, messageId: string): Promise<boolean> {
  const entry = active.get(messageId);
  if (entry && entry.userId === userId) {
    entry.controller.abort();
    return true;
  }
  return requestStop(userId, messageId);
}

/** Aborts this instance's answers for a deleted conversation or account. */
export function abortChats(filter: { userId: string; conversationId?: string }): void {
  for (const entry of active.values()) {
    if (entry.userId !== filter.userId) continue;
    if (filter.conversationId && entry.conversationId !== filter.conversationId) continue;
    entry.controller.abort();
  }
}

/** Aborts every running answer and waits (bounded) for their outcomes to be stored. */
export async function abortAllChats(timeoutMs: number): Promise<string[]> {
  const entries = [...active.entries()];
  for (const [, entry] of entries) entry.controller.abort(new ShutdownError());
  await Promise.race([
    Promise.allSettled(entries.map(([, entry]) => entry.done)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  return entries.map(([messageId]) => messageId);
}
