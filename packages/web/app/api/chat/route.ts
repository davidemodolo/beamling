import { z } from "zod";
import { MODES, SEARCH_PROVIDER_IDS } from "@/lib/contracts";
import { ClientDisconnectError, watchChat } from "@/lib/server/active-chats";
import { analytics } from "@/lib/server/analytics";
import { prepareChat, publicError, runChat, TIMEOUT_MS, type ChatEmit } from "@/lib/server/answer-pipeline";
import { MAX_CONTEXT_FILES, MAX_CONTEXT_IMAGES, MAX_FILES_PER_QUESTION, MAX_IMAGES_PER_QUESTION } from "@/lib/attachments";
import { maxConcurrentChatsPerUser } from "@/lib/server/env";
import { ApiError, cleanText, clientIpKey, json, MAX_BODY_BYTES, parseBody } from "@/lib/server/http";
import { fileUpload, imageUpload, MAX_BASE64_CHARS, MAX_FILE_BODY_BYTES } from "@/lib/server/image-upload";
import { MAX_QUESTION_CHARS, QUESTIONS_PER_DAY, QUESTIONS_PER_HOUR } from "@/lib/legal";
import { acceptingNewStreams, consumeRateLimit, questionLimitKeys } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";
import { isShuttingDown } from "@/lib/server/shutdown-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 360;

const CHATS_PER_IP_PER_HOUR = 120;

const question = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .trim()
      .max(MAX_QUESTION_CHARS, `Questions are limited to ${MAX_QUESTION_CHARS.toLocaleString("en")} characters.`),
  );

const images = (max: number, message: string) => z.array(imageUpload).max(max, message).optional();
const files = (max: number, message: string) => z.array(fileUpload).max(max, message).optional();

// Images and text files make the body larger than other routes allow; this is the most a valid
// request can carry (each image's base64 plus room for its id and type, and each file's text).
const CHAT_BODY_BYTES =
  MAX_BODY_BYTES +
  (MAX_IMAGES_PER_QUESTION + MAX_CONTEXT_IMAGES) * (MAX_BASE64_CHARS + 200) +
  (MAX_FILES_PER_QUESTION + MAX_CONTEXT_FILES) * (MAX_FILE_BODY_BYTES + 400);

// A new question, or a new answer for the latest question (`retryOf` names the answer it replaces).
// With `retryOf`, a `question` is the edited text of that question; without one the stored text is
// reused. `attachments` and `files` belong to a new question; `context` and `contextFiles` re-send
// earlier ones the browser still has.
const schema = z
  .object({
    conversationId: z.string().uuid().optional(),
    question: question.optional(),
    attachments: images(MAX_IMAGES_PER_QUESTION, `Attach at most ${MAX_IMAGES_PER_QUESTION} images.`),
    context: images(MAX_CONTEXT_IMAGES, "Too many earlier images."),
    files: files(MAX_FILES_PER_QUESTION, `Attach at most ${MAX_FILES_PER_QUESTION} text files.`),
    contextFiles: files(MAX_CONTEXT_FILES, "Too many earlier files."),
    retryOf: z.string().uuid().optional(),
    mode: z.enum(MODES),
    searchProvider: z.enum(SEARCH_PROVIDER_IDS).optional(),
  })
  .refine((input) => input.question !== undefined || input.retryOf !== undefined, {
    message: "Send a question or the answer to replace.",
  })
  .refine((input) => input.retryOf || input.question || input.attachments?.length || input.files?.length, {
    message: "Ask a question first.",
  })
  .refine((input) => !input.retryOf || !(input.attachments?.length || input.files?.length), {
    message: "A new answer reuses the question's attachments.",
  })
  .refine((input) => !input.retryOf || input.conversationId, {
    message: "A new answer needs its conversation.",
  });

/**
 * Chat requests being read or prepared on this instance, per account. Bodies carry images, so an
 * account may only have as many in memory as it may have answers running.
 */
const starting = new Map<string, number>();

function beginStart(userId: string): () => void {
  const count = starting.get(userId) ?? 0;
  if (count >= maxConcurrentChatsPerUser()) {
    throw new ApiError("SERVER_BUSY", "Your previous question is still starting. Try again in a moment.", 429);
  }
  starting.set(userId, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (starting.get(userId) ?? 1) - 1;
    if (left > 0) starting.set(userId, left);
    else starting.delete(userId);
  };
}

const encoder = new TextEncoder();

function event(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const POST = apiRoute(async ({ request, user }) => {
  if (isShuttingDown()) {
    return json(
      { error: { code: "SERVICE_BUSY", message: "Beamling is restarting. Try again shortly." } },
      { status: 503, headers: { "Retry-After": "15" } },
    );
  }
  const gate = await acceptingNewStreams();
  if (!gate.enabled) {
    return json(
      { error: { code: "SERVICE_BUSY", message: "Beamling is briefly at capacity. Try again shortly." } },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  // Limits come before the body: it can be megabytes of images, and a spent budget must not buffer it.
  const keys = questionLimitKeys(user.id);
  await consumeRateLimit(keys.hour, QUESTIONS_PER_HOUR, 3600);
  await consumeRateLimit(keys.day, QUESTIONS_PER_DAY, 86_400);
  await consumeRateLimit(`chat-ip:${clientIpKey(request.headers)}`, CHATS_PER_IP_PER_HOUR, 3600);
  const started = beginStart(user.id);
  let input: z.infer<typeof schema>;
  let prepared: Awaited<ReturnType<typeof prepareChat>>;
  try {
    input = await parseBody(request, schema, CHAT_BODY_BYTES);
    prepared = await prepareChat({ userId: user.id, ...input });
  } finally {
    // From here the per-account answer limit (enforced by prepareChat) bounds what stays in memory.
    started();
  }
  analytics.capture(user.id, "question_asked", {
    mode: prepared.mode,
    search_provider: prepared.searchProvider,
    llm_model: prepared.llm.id,
    images: prepared.attachments.filter((item) => item.kind === "image").length,
  });

  const internal = new AbortController();
  // The request signal is forwarded through `shutdown`, so the combined signal carries a specific
  // ClientDisconnectError instead of an unclassified DOMException.
  const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS[input.mode]), internal.signal]);
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
    internal.abort(new ClientDisconnectError());
    clearInterval(heartbeat);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          shutdown();
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
