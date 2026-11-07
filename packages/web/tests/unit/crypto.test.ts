import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { decryptCredential, encryptCredential, isDecryptIntegrityError } from "../../lib/server/crypto";
import { configureUnitEnv, withEnv } from "./helpers";

configureUnitEnv();

test("credential envelope encryption round-trips", async () => {
  const userId = "6d1f2a8e-3fd5-4e42-9969-4c18f3da0f32";
  const encrypted = await encryptCredential(userId, "llm", "openrouter", "sk-or-v1-secret-1234");
  assert.equal(encrypted.last4, "1234");
  assert.equal(encrypted.keyId, "k1");
  assert.notEqual(encrypted.ciphertext, "sk-or-v1-secret-1234");
  assert.equal(await decryptCredential(userId, { ...encrypted, kind: "llm", provider: "openrouter" }), "sk-or-v1-secret-1234");
});

test("credential envelope is bound to its owner", async () => {
  const encrypted = await encryptCredential("user-a", "search", "brave", "BSA-secret-9999");
  await assert.rejects(decryptCredential("user-b", { ...encrypted, kind: "search", provider: "brave" }));
});

test("a tampered credential is an integrity failure, a KMS outage is not", async () => {
  const encrypted = await encryptCredential("user-a", "search", "brave", "BSA-secret-9999");
  const error = await decryptCredential("user-b", { ...encrypted, kind: "search", provider: "brave" }).catch((cause) => cause);
  assert.equal(isDecryptIntegrityError(error), true);
  assert.equal(isDecryptIntegrityError(Object.assign(new Error("14 UNAVAILABLE: connection reset"), { code: 14 })), false);
  assert.equal(isDecryptIntegrityError(new TypeError("fetch failed")), false);
});

test("short keys do not reveal their last four characters", async () => {
  const short = await encryptCredential("user-a", "search", "exa", "abcd1234");
  assert.equal(short.last4, "••••");
  const long = await encryptCredential("user-a", "llm", "openrouter", "sk-or-v1-0123456789abcdef");
  assert.equal(long.last4, "cdef");
});

test("credentials survive a master key rotation and re-wrap", async (t) => {
  const { loadKeys, rewrapRow } = await import("../../scripts/rewrap-credentials.mjs");
  const oldKey = process.env.CREDENTIAL_MASTER_KEY as string;
  const userId = "0f2b6a50-58a3-4d8c-8a52-7d7a4c8ab001";
  const encrypted = await encryptCredential(userId, "llm", "openrouter", "sk-or-v1-rotate-me");

  const newKey = randomBytes(32).toString("base64");
  withEnv(t, {
    CREDENTIAL_MASTER_KEY: newKey,
    CREDENTIAL_MASTER_KEY_ID: "k2",
    CREDENTIAL_PREVIOUS_MASTER_KEYS: `k1:${oldKey}`,
  });
  // Before the re-wrap, the retired key still decrypts.
  assert.equal(await decryptCredential(userId, { ...encrypted, kind: "llm", provider: "openrouter" }), "sk-or-v1-rotate-me");

  const next = rewrapRow(
    {
      id: encrypted.id,
      user_id: userId,
      kind: "llm",
      provider: "openrouter",
      key_id: encrypted.keyId,
      wrapped_dek: encrypted.wrappedDek,
      dek_nonce: encrypted.dekNonce,
      dek_tag: encrypted.dekTag,
    },
    loadKeys(),
  );
  assert.equal(next.key_id, "k2");
  const rewrapped = {
    ...encrypted,
    keyId: next.key_id,
    wrappedDek: next.wrapped_dek,
    dekNonce: next.dek_nonce,
    dekTag: next.dek_tag,
    kind: "llm",
    provider: "openrouter",
  };
  // Without the retired key, only the re-wrapped row decrypts.
  process.env.CREDENTIAL_PREVIOUS_MASTER_KEYS = "";
  assert.equal(await decryptCredential(userId, rewrapped), "sk-or-v1-rotate-me");
  await assert.rejects(decryptCredential(userId, { ...encrypted, kind: "llm", provider: "openrouter" }));
});

test("workspace keys survive a master key rotation and re-wrap", async (t) => {
  const { loadKeys, rewrapWorkspaceRow } = await import("../../scripts/rewrap-credentials.mjs");
  const { unwrapKey, wrapKey } = await import("../../lib/server/kms");
  const oldKey = process.env.CREDENTIAL_MASTER_KEY as string;
  const userId = "0f2b6a50-58a3-4d8c-8a52-7d7a4c8ab002";
  const aad = `beamling:wdk:v1:${userId}`;
  const workspaceKey = randomBytes(32);
  const wrapped = await wrapKey(workspaceKey, aad);

  withEnv(t, {
    CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
    CREDENTIAL_MASTER_KEY_ID: "k2",
    CREDENTIAL_PREVIOUS_MASTER_KEYS: `k1:${oldKey}`,
  });
  const next = rewrapWorkspaceRow(
    {
      user_id: userId,
      key_id: wrapped.keyId,
      wrapped_key: wrapped.wrappedKey,
      wrap_nonce: wrapped.nonce as string,
      wrap_tag: wrapped.tag as string,
    },
    loadKeys(),
  );
  assert.equal(next.key_id, "k2");
  process.env.CREDENTIAL_PREVIOUS_MASTER_KEYS = "";
  const opened = await unwrapKey({ keyId: next.key_id, wrappedKey: next.wrapped_key, nonce: next.wrap_nonce, tag: next.wrap_tag }, aad);
  assert.deepEqual(opened, workspaceKey);
  await assert.rejects(unwrapKey(wrapped, aad));
});

test("stored content without an encryption envelope fails closed", async () => {
  const { decryptText } = await import("../../lib/server/workspace-key");
  await assert.rejects(
    () => decryptText("user", "messages", "row", "content", "legacy plaintext"),
    /not encrypted/,
  );
  assert.equal(await decryptText("user", "messages", "row", "content", ""), "");
});
