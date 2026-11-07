# Credentials

## Accepted credentials

One key per provider. `lib/provider-catalog.ts` holds each provider's name, key format, link, free-check flag, key limits, search list price and notice; `lib/contracts.ts` holds ids and capabilities.

| Kind | Provider | Validation call |
|---|---|---|
| `llm` | `openrouter` | `GET https://openrouter.ai/api/v1/key`, 15 s timeout |
| `llm` (also serves search) | `deepseek` | `GET https://api.deepseek.com/user/balance`; free; no balance → `INSUFFICIENT_CREDITS` |
| `search` | `brave` | `GET https://api.search.brave.com/res/v1/web/search?q=Beamling%20connectivity%20test&count=1` |
| `search` | `tavily` | `GET https://api.tavily.com/usage`; free; rejects a key at its usage limit |
| `search` | `exa` | `POST https://api.exa.ai/search` with one highlight result |

`POST /api/credentials` takes `{ provider, key, ... }`:

- `kind` is derived, not sent: `llm` if the provider has models, else `search`. It is stored because the AAD binds it. Unknown fields are ignored.
- Brave and Exa checks spend one search, so only they accept `validate: false` (others: `INVALID_INPUT`). The key is saved `unverified`, without `last_validated_at`, and works for answers; the UI offers a "Validate the key now" checkbox and a later Validate button.
- Plan, expiry and budget are accepted only for Brave.
- A key whose provider left the catalog shows as unsupported and can only be deleted; revalidation returns `INVALID_PROVIDER`.

## Envelope encryption

Each credential gets a fresh 32-byte DEK; the key is encrypted with AES-256-GCM under it, and the DEK is wrapped by KMS (columns in [Tables](conversations.md#tables)).

Ciphertext AAD, and the separate KMS wrap context:

```text
beamling:v1:<userId>:<credentialId>:<kind>:<provider>
beamling:credential:v1:<userId>:<credentialId>:<kind>:<provider>
```

Both are rebuilt on every decrypt. `dek_nonce`/`dek_tag` are set only by the env adapter; AWS/GCP blobs carry their own integrity.

Display data:

- `fingerprint`: first 16 hex chars of HMAC-SHA256(key) with the `credential-fingerprint` subkey of `AUTH_SECRET`.
- `last4`: last four characters for keys of 20+ characters, else `••••`.
- The API returns id, kind, provider, last4, status, limit metadata and validation time; never the key.

## Validation and status

Saving validates first (unless `validate: false`); a failure returns a provider error and writes nothing. `POST /api/credentials/:id/validate` revalidates:

- Decrypt failure from KMS, network or config: `PROVIDER_UNAVAILABLE` (503), status unchanged. Integrity failure (`isDecryptIntegrityError`: AES-GCM auth, AWS `InvalidCiphertextException`, GCP `INVALID_ARGUMENT`): `status = invalid`, `CREDENTIAL_UNREADABLE`.
- Success → `active`; rejected or out of credit → `invalid`; rate-limited → `rate_limited`; outage → unchanged.

Statuses: `active`, `invalid`, `rate_limited`, `unverified`.

Limits: 20 credential operations per user per fixed hour. Provider checks also count against 50 per account per fixed day and 120 per hashed IP per fixed hour, so the server can't test leaked-key lists.

## Replace, delete, rotation

- Replacing encrypts first, then updates the `(user, kind, provider)` row in place, keeping id and usage. A failure leaves the old key working; a concurrent losing insert returns the winner's row.
- Fingerprints and Brave slot keys are keyed HMACs, so a database reader can't test keys offline.
- Save and delete log `credential_saved` / `credential_deleted` ([audit](security.md#logging-and-error-handling)).
- Delete hard-deletes the row and usage and releases the Brave slot (if decryptable). No recovery.
- Env-adapter master-key rotation:
  1. Deploy a new `CREDENTIAL_MASTER_KEY` with a new `CREDENTIAL_MASTER_KEY_ID`.
  2. Put the old key in `CREDENTIAL_PREVIOUS_MASTER_KEYS`.
  3. Run `node scripts/rewrap-credentials.mjs`.
  4. Remove the old key only when the script reports no row uses it.

The script (env adapter only) re-wraps credential DEKs and `user_data_keys` workspace keys, not ciphertext. It skips rows changed meanwhile (compare-and-set on the old wrapped key), then exits 1 with counts if any row still uses an old key.

AWS/GCP unwrap with the stored `key_id`, so a new `KMS_KEY_NAME`/`KMS_KEY_ID` applies to new writes and old rows stay readable. Rows move lazily on read:

- Workspace keys re-wrap when the configured key id changes.
- `readCredentialKey` (answers, revalidation) re-encrypts a provider key whose `key_id` differs from `currentKmsKeyId()`, keeping the row id; compare-and-set on `wrapped_dek`; failures retry next read.
- On AWS, `currentKmsKeyId()` resolves `KMS_KEY_ID` to an ARN once per process via `DescribeKey` (needs `kms:DescribeKey`); on failure rows stay as they are.

## Current data-protection boundary

| Data | At rest |
|---|---|
| Provider API keys | AES-256-GCM envelope ciphertext; DEK wrapped by the configured KMS |
| Workspace data key | 32 random bytes, wrapped by the configured KMS |
| Session token | SHA-256 hash only |
| Titles, message content, source fields, search trace, reasoning | AES-256-GCM under the account's workspace key |
| Stored provider error messages | AES-256-GCM; fixed `INTERRUPTED` text is plaintext |
| Usage counters and costs | Plaintext metadata |
| Request logs | JSON; no bodies, credentials or SQL parameters |

- Envelope: `enc:v1:<base64url JSON>` (nonce, ciphertext, tag, key version); AAD `beamling:content:v1:<userId>:<table>:<rowId>:<field>`.
- The workspace key (`user_data_keys`, created at first sign-in) is cached per process for up to 500 accounts.
- Reads fail closed: non-envelope values are rejected, except the empty string and "The answer was interrupted.".
- Not end-to-end: a database dump yields ciphertext, but the app can decrypt for the owner.

## Search-provider limits

- Brave keys need a user-declared plan: `free` (spacing `BRAVE_MIN_INTERVAL_MS`, default 1,100 ms) or `paid` (`BRAVE_PAID_MIN_INTERVAL_MS`, default 0).
- Optional user-declared `expires_on` and monthly `budget_usd` (Brave only; not checked with Brave). `budget_period` is stored as `month`, not exposed by the API.
- `credential_usage` stores daily requests and estimated cost for every provider. `listCredentials` sums the current month (from `budget_started_at` if set this month) into `spentUsd`, `requests` and a warning: `budget_100`, `budget_80`, `expiry_1`, `expiry_7` or `expiry_14`.
- Warnings never block a search; provider `402` is authoritative. The UI labels limits as user-set.
