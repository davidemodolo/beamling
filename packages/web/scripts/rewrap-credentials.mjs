// Re-wraps every credential's data key with the current master key, after a rotation.
//
// 1. Deploy with the new key as CREDENTIAL_MASTER_KEY (and a new CREDENTIAL_MASTER_KEY_ID), and the
//    old one listed in CREDENTIAL_PREVIOUS_MASTER_KEYS as "oldId:base64".
// 2. Run: node scripts/rewrap-credentials.mjs
// 3. Remove the old key from CREDENTIAL_PREVIOUS_MASTER_KEYS.
//
// Only the wrapped data key changes; the encrypted provider keys are untouched.
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

/** Returns the new wrapped-key fields for one credential row (snake_case, as stored). */
export function rewrapRow(row, keys) {
  const oldKey = keys.byId.get(row.key_id);
  if (!oldKey) throw new Error(`No master key with id "${row.key_id}" is configured (credential ${row.id}).`);
  const wrapAadValue = wrapAad(row.user_id, row.id, row.kind, row.provider);

  const decipher = createDecipheriv(ALGORITHM, oldKey, Buffer.from(row.dek_nonce, "base64"));
  decipher.setAAD(wrapAadValue);
  decipher.setAuthTag(Buffer.from(row.dek_tag, "base64"));
  const dek = Buffer.concat([decipher.update(Buffer.from(row.wrapped_dek, "base64")), decipher.final()]);

  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keys.current.key, nonce);
  cipher.setAAD(wrapAadValue);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    key_id: keys.current.id,
    wrapped_dek: wrapped.toString("base64"),
    dek_nonce: nonce.toString("base64"),
    dek_tag: cipher.getAuthTag().toString("base64"),
  };
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
