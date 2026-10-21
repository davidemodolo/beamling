import { z } from "zod";
import { watchChat } from "@/lib/server/active-chats";
import { analytics } from "@/lib/server/analytics";
import { prepareChat, publicError, runChat, TIMEOUT_MS, type ChatEmit } from "@/lib/server/chat";
import { cleanText, clientIpKey, parseBody } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 360;

const CHATS_PER_USER_PER_HOUR = 30;
const CHATS_PER_IP_PER_HOUR = 120;

const question = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .trim()
      .min(1, "Ask a question first.")
      .max(4000, "Questions are limited to 4,000 characters."),
  );

// A new question, or a retry of the latest failed or stopped answer (the server reuses its question).
const schema = z
  .object({
    conversationId: z.string().uuid().optional(),
    question: question.optional(),
    retryOf: z.string().uuid().optional(),
    mode: z.enum(["quick", "deep", "deeper"]),
    searchProvider: z.enum(["brave", "tavily", "exa"]).optional(),
  })
  .refine((input) => (input.question === undefined) !== (input.retryOf === undefined), {
    message: "Send either a question or the answer to retry.",
  })
  .refine((input) => !input.retryOf || input.conversationId, {
    message: "A retry needs its conversation.",
  });

const encoder = new TextEncoder();

function event(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const POST = apiRoute(async ({ request, user }) => {
  const input = await parseBody(request, schema);
  await consumeRateLimit(`chat:${user.id}`, CHATS_PER_USER_PER_HOUR, 3600);
  await consumeRateLimit(`chat-ip:${clientIpKey(request.headers)}`, CHATS_PER_IP_PER_HOUR, 3600);
  const prepared = await prepareChat({ userId: user.id, ...input });
  analytics.capture(user.id, "question_asked", {
    mode: prepared.mode,
    search_provider: prepared.searchProvider,
    llm_model: prepared.model,
  });

  const internal = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS[input.mode]), internal.signal]);
  let markDone!: () => void;
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });
  const unwatch = watchChat(
    prepared.messageId,
    { userId: user.id, conversationId: prepared.conversationId },
    internal,
    done,
  );
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const shutdown = () => {
    closed = true;
    internal.abort();
    clearInterval(heartbeat);
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
          markDone();
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
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
