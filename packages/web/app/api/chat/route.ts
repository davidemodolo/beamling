import { z } from "zod";
import { prepareChat, publicError, runChat, type ChatEmit } from "@/lib/server/chat";
import { assertSameOrigin, clientIpKey, errorResponse, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { watchChat } from "@/lib/server/active-chats";
import { consumeRateLimit } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHATS_PER_USER_PER_HOUR = 30;
const CHATS_PER_IP_PER_HOUR = 120;

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  question: z.string().trim().min(1).max(4000),
  mode: z.enum(["quick", "deep"]),
});

const encoder = new TextEncoder();

function event(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = await parseBody(request, schema);
    await consumeRateLimit(`chat:${user.id}`, CHATS_PER_USER_PER_HOUR, 3600);
    await consumeRateLimit(`chat-ip:${clientIpKey(request.headers)}`, CHATS_PER_IP_PER_HOUR, 3600);
    const prepared = await prepareChat({ userId: user.id, ...input });

    // Hard caps from the spec; a timeout keeps partial text and stores the answer as stopped.
    const timeout = input.mode === "deep" ? 90_000 : 60_000;
    const internal = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout), internal.signal]);
    const unwatch = watchChat(prepared.messageId, user.id, internal);
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const shutdown = () => {
      closed = true;
      internal.abort();
      clearInterval(heartbeat);
      unwatch();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (chunk: Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        };
        const emit: ChatEmit = (name, data) => write(event(name, data));

        heartbeat = setInterval(() => write(encoder.encode(": ping\n\n")), 15_000);
        request.signal.addEventListener("abort", shutdown, { once: true });

        void runChat(prepared, { signal, emit })
          .catch((error) => {
            if (!signal.aborted) emit("error", publicError(error));
          })
          .finally(() => {
            clearInterval(heartbeat);
            unwatch();
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {}
            }
          });
      },
      cancel: shutdown,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
