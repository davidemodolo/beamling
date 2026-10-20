import { isStopRequested, requestStop } from "./repo";

const STOP_POLL_MS = 1500;

interface ActiveChat {
  userId: string;
  controller: AbortController;
}

// Fast path for stops that land on the instance running the answer. Other instances reach it
// through the message's stop flag, which every running answer polls.
const active = new Map<string, ActiveChat>();

/** Registers a running answer and returns the function that unregisters it. */
export function watchChat(messageId: string, userId: string, controller: AbortController): () => void {
  active.set(messageId, { userId, controller });
  let polling = false;
  const timer = setInterval(() => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    isStopRequested(messageId)
      .then((stop) => {
        if (stop) controller.abort();
      })
      .catch((error) => console.warn("Stop flag check failed", error))
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
