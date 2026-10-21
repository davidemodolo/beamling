// Re-wraps every credential data key and every workspace data key with the current master key,
// after a rotation of the environment KMS adapter.
//
// 1. Deploy with the new key as CREDENTIAL_MASTER_KEY (and a new CREDENTIAL_MASTER_KEY_ID), and the
//    old one listed in CREDENTIAL_PREVIOUS_MASTER_KEYS as "oldId:base64".
// 2. Run: node scripts/rewrap-credentials.mjs
// 3. Remove the old key from CREDENTIAL_PREVIOUS_MASTER_KEYS only after the script reports that no
//    row still uses it; otherwise the keys and content of those accounts become unreadable.
//
// Only the wrapped data keys change; encrypted provider keys and workspace content are untouched.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ALGORITHM = "aes-256-gcm";

// Must match credentialAad in lib/server/crypto.ts.
export function credentialAad(userId, credentialId, kind, provider) {
  return Buffer.from(`beamling:v1:${userId}:${credentialId}:${kind}:${provider}`, "utf8");
}

// Must match the AAD used by the environment KMS adapter in lib/server/kms.ts.
export function wrapAad(userId, credentialId, kind, provider) {
  return Buffer.from(`beamling:credential:v1:${userId}:${credentialId}:${kind}:${provider}`, "utf8");
}

function decodeKey(name, raw) {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${name} must be exactly 32 bytes, base64 encoded.`);
  return key;
}

/** The configured keys: the current one and any retired ones still able to unwrap. */
export function loadKeys(env = process.env) {
  if (!env.CREDENTIAL_MASTER_KEY) throw new Error("CREDENTIAL_MASTER_KEY is required.");
  const current = { id: env.CREDENTIAL_MASTER_KEY_ID || "k1", key: decodeKey("CREDENTIAL_MASTER_KEY", env.CREDENTIAL_MASTER_KEY) };
  const byId = new Map([[current.id, current.key]]);
  for (const entry of (env.CREDENTIAL_PREVIOUS_MASTER_KEYS ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("CREDENTIAL_PREVIOUS_MASTER_KEYS entries must look like id:base64key.");
    const id = entry.slice(0, separator).trim();
    byId.set(id, decodeKey(`CREDENTIAL_PREVIOUS_MASTER_KEYS (${id})`, entry.slice(separator + 1).trim()));
  }
  return { current, byId };
}

// Must match wdkAad in lib/server/workspace-key.ts.
export function workspaceWrapAad(userId) {
  return Buffer.from(`beamling:wdk:v1:${userId}`, "utf8");
}

/** Unwraps a data key with the master key it names and wraps it again with the current one. */
function rewrap(keys, keyId, wrapped, nonce, tag, aad, label) {
  const oldKey = keys.byId.get(keyId);
  if (!oldKey) throw new Error(`No master key with id "${keyId}" is configured (${label}).`);
  const decipher = createDecipheriv(ALGORITHM, oldKey, Buffer.from(nonce, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const dek = Buffer.concat([decipher.update(Buffer.from(wrapped, "base64")), decipher.final()]);

  const nextNonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keys.current.key, nextNonce);
  cipher.setAAD(aad);
  const next = Buffer.concat([cipher.update(dek), cipher.final()]);
  return { wrapped: next.toString("base64"), nonce: nextNonce.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

/** Returns the new wrapped-key fields for one credential row (snake_case, as stored). */
export function rewrapRow(row, keys) {
  const next = rewrap(
    keys,
    row.key_id,
    row.wrapped_dek,
    row.dek_nonce,
    row.dek_tag,
    wrapAad(row.user_id, row.id, row.kind, row.provider),
    `credential ${row.id}`,
  );
  return { key_id: keys.current.id, wrapped_dek: next.wrapped, dek_nonce: next.nonce, dek_tag: next.tag };
}

/** Returns the new wrapped-key fields for one user_data_keys row (snake_case, as stored). */
export function rewrapWorkspaceRow(row, keys) {
  const next = rewrap(
    keys,
    row.key_id,
    row.wrapped_key,
    row.wrap_nonce,
    row.wrap_tag,
    workspaceWrapAad(row.user_id),
    `workspace key of ${row.user_id}`,
  );
  return { key_id: keys.current.id, wrapped_key: next.wrapped, wrap_nonce: next.nonce, wrap_tag: next.tag };
}

async function main() {
  const require = createRequire(import.meta.url);
  const pg = require("pg");
  const keys = loadKeys();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const ssl =
    process.env.DATABASE_SSL === "true"
      ? {
          rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
          ca: process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") || (process.env.DATABASE_SSL_CA_FILE ? (await import("node:fs")).readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") : undefined),
        }
      : undefined;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select id, user_id, kind, provider, key_id, wrapped_dek, dek_nonce, dek_tag from credentials where key_id <> $1",
      [keys.current.id],
    );
    let updated = 0;
    for (const row of rows) {
      const next = rewrapRow(row, keys);
      // Matching on the old wrapped key skips rows replaced by the user in the meantime.
      const result = await client.query(
        "update credentials set key_id = $1, wrapped_dek = $2, dek_nonce = $3, dek_tag = $4, updated_at = now() where id = $5 and wrapped_dek = $6",
        [next.key_id, next.wrapped_dek, next.dek_nonce, next.dek_tag, row.id, row.wrapped_dek],
      );
      updated += result.rowCount;
    }
    console.log(`Re-wrapped ${updated} of ${rows.length} credentials with key "${keys.current.id}".`);

    const workspaces = await client.query(
      "select user_id, key_id, wrapped_key, wrap_nonce, wrap_tag from user_data_keys where key_id <> $1",
      [keys.current.id],
    );
    let rewrappedWorkspaces = 0;
    for (const row of workspaces.rows) {
      const next = rewrapWorkspaceRow(row, keys);
      // Matching on the old wrapped key skips rows the application re-wrapped in the meantime.
      const result = await client.query(
        "update user_data_keys set key_id = $1, wrapped_key = $2, wrap_nonce = $3, wrap_tag = $4, rotated_at = now() where user_id = $5 and wrapped_key = $6",
        [next.key_id, next.wrapped_key, next.wrap_nonce, next.wrap_tag, row.user_id, row.wrapped_key],
      );
      rewrappedWorkspaces += result.rowCount;
    }
    console.log(`Re-wrapped ${rewrappedWorkspaces} of ${workspaces.rows.length} workspace keys with key "${keys.current.id}".`);

    const { rows: remaining } = await client.query(
      "select (select count(*) from credentials where key_id <> $1)::int as credentials, (select count(*) from user_data_keys where key_id <> $1)::int as workspaces",
      [keys.current.id],
    );
    const left = remaining[0];
    if (left.credentials || left.workspaces) {
      console.error(
        `${left.credentials} credentials and ${left.workspaces} workspace keys still use an old master key. Do not remove it yet; run the script again.`,
      );
      process.exitCode = 1;
    } else {
      console.log("No row uses an old master key. It is safe to remove it from CREDENTIAL_PREVIOUS_MASTER_KEYS.");
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
