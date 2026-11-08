import assert from "node:assert/strict";
import { test } from "node:test";
import { configureUnitEnv } from "./helpers";

configureUnitEnv();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ID = "00000000-0000-4000-8000-000000000001";

test("an image upload must be a known type whose bytes match it", async () => {
  const { imageUpload } = await import("../../lib/server/image-upload");
  const parse = (mediaType: string, bytes: Buffer) =>
    imageUpload.safeParse({ id: ID, mediaType, data: bytes.toString("base64") }).success;
  assert.equal(parse("image/png", PNG), true);
  assert.equal(parse("image/jpeg", PNG), false, "declared JPEG, PNG bytes");
  assert.equal(parse("image/gif", PNG), false, "unsupported type");
  assert.equal(parse("image/png", Buffer.from("<svg onload=alert(1)>")), false);
  assert.equal(imageUpload.safeParse({ id: ID, mediaType: "image/png", data: "not base64!" }).success, false);
});

test("prompts mark each image as included or no longer available, and never describe it", async () => {
  const { promptQuestion, researchRequest } = await import("../../lib/server/prompts");
  const attachment = { id: ID, kind: "image" as const, mediaType: "image/png" as const };
  const sent = new Set([ID]);
  assert.equal(promptQuestion("What brand?", [], sent), "What brand?");
  assert.equal(promptQuestion("What brand?", [attachment], sent), "What brand?\n[Image 1 attached; it is included with this message]");
  assert.match(promptQuestion("", [attachment], sent), /^\(No text: the question is the attached image\.\)/);
  const history = [
    { id: "q", role: "user" as const, content: "What is this?", status: "complete" as const, createdAt: "", attachments: [attachment] },
  ];
  assert.match(researchRequest("And its price?", history, sent), /User: What is this\?\n\[Image 1 attached; it is included/);
  assert.match(researchRequest("And its price?", history, new Set()), /\[Image 1 attached; it is no longer available, so do not guess/);
});

test("HTML entities are decoded once, so encoded markup stays text", async () => {
  const { plainText } = await import("../../lib/server/providers/shared");
  assert.equal(plainText("a &amp;lt;b&amp;gt; &lt;i&gt;"), "a &lt;b&gt; <i>");
});

test("every catalog model declares whether it reads images; unknown ids follow the default model", async () => {
  const { MODELS, modelReadsImages } = await import("../../lib/provider-catalog");
  for (const model of MODELS) assert.equal(typeof model.vision, "boolean", model.id);
  assert.equal(modelReadsImages("retired/model"), MODELS[0].vision);
});
