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
const CLIENT_DISCONNECT = "ClientDisconnectError";
const USER_STOP = "UserStopError";

/** Abort reason for answers cut short by a server shutdown. */
export class ShutdownError extends Error {
  constructor() {
    super("The server is shutting down.");
    this.name = SHUTDOWN;
  }
}

/** Abort reason for a response stream that the client closed or that failed to enqueue. */
export class ClientDisconnectError extends Error {
  constructor() {
    super("The client disconnected.");
    this.name = CLIENT_DISCONNECT;
  }
}

/** Abort reason for an explicit Stop action. */
export class UserStopError extends Error {
  constructor() {
    super("The user stopped the answer.");
    this.name = USER_STOP;
  }
}

/** Checked by name: the shutdown hook and the routes are separate bundles with separate classes. */
export function isShutdown(reason: unknown): boolean {
  return reason instanceof Error && reason.name === SHUTDOWN;
}

export function isClientDisconnect(reason: unknown): boolean {
  return reason instanceof Error && reason.name === CLIENT_DISCONNECT;
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
    entry.controller.abort(new UserStopError());
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

/**
 * Aborts every running answer and waits (bounded) for their outcomes to be stored. It loops so a
 * request that passed the shutdown gate just before the flag was set still gets drained.
 */
export async function abortAllChats(timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<string>();
  while (Date.now() < deadline) {
    const entries = [...active.entries()].filter(([messageId]) => !seen.has(messageId));
    if (!entries.length) break;
    for (const [messageId, entry] of entries) {
      seen.add(messageId);
      entry.controller.abort(new ShutdownError());
    }
    await Promise.race([
      Promise.allSettled(entries.map(([, entry]) => entry.done)),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
    ]);
  }
  // A last pass catches an entry registered while the final wait was resolving.
  for (const [messageId, entry] of active.entries()) {
    if (seen.has(messageId)) continue;
    seen.add(messageId);
    entry.controller.abort(new ShutdownError());
  }
  return [...seen];
}
