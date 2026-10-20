import { z } from "zod";
import { runChat } from "@/lib/server/chat";
import { ApiError, assertSameOrigin, errorResponse, parseBody } from "@/lib/server/http";
import { getOrCreateUser } from "@/lib/server/session";
import { registerChat, unregisterChat } from "@/lib/server/active-chats";
import { consumeRateLimit } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  question: z.string().trim().min(1).max(4000),
  mode: z.enum(["quick", "deep"]),
});

function event(name: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getOrCreateUser();
    await consumeRateLimit(`chat:${user.id}`, 30, 3600);
    const input = await parseBody(request, schema);
    const timeout = input.mode === "deep" ? 90_000 : 60_000;
    const internal = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout), internal.signal]);
    const encoder = new TextEncoder();
    let closed = false;
    let messageId: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

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
        const emit = (name: string, data: unknown) => {
          if (name === "meta") {
            const meta = data as { messageId?: string };
            if (meta.messageId) {
              messageId = meta.messageId;
              registerChat(meta.messageId, user.id, internal);
            }
          }
          write(event(name, data));
        };

        heartbeat = setInterval(() => {
          write(encoder.encode(": ping\n\n"));
        }, 15_000);
        request.signal.addEventListener("abort", () => {
          closed = true;
          internal.abort();
          clearInterval(heartbeat);
        });

        void runChat({
          userId: user.id,
          conversationId: input.conversationId,
          question: input.question,
          mode: input.mode,
          signal,
          emit,
        })
          .catch((error) => {
            if (signal.aborted) return;
            emit("error", {
              code: error instanceof ApiError ? error.code : "INTERNAL",
              message: error instanceof Error ? error.message : "The answer could not be completed.",
              provider: error instanceof ApiError ? error.provider : undefined,
            });
          })
          .finally(() => {
            clearInterval(heartbeat);
            if (messageId) unregisterChat(messageId);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {}
            }
          });
      },
      cancel() {
        closed = true;
        internal.abort();
        if (heartbeat) clearInterval(heartbeat);
        if (messageId) unregisterChat(messageId);
      },
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
