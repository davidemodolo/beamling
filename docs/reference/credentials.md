# Credentials

## Accepted credentials

Every provider has one key, whatever it is used for. The provider catalog (`lib/provider-catalog.ts`) lists each provider's name, key format and link, whether its check is free, whether its key has limits (plan, expiry, budget), its search list price and an optional notice. The provider ids and their capabilities (models, search) are in `lib/contracts.ts`.

| Kind | Provider | Validation call |
|---|---|---|
| `llm` | `openrouter` | `GET https://openrouter.ai/api/v1/key`, 15-second timeout |
| `llm` (also serves search) | `deepseek` | `GET https://api.deepseek.com/user/balance`; spends nothing and rejects a key whose balance is not available (`INSUFFICIENT_CREDITS`) |
| `search` | `brave` | `GET https://api.search.brave.com/res/v1/web/search?q=Beamling%20connectivity%20test&count=1` |
| `search` | `tavily` | `GET https://api.tavily.com/usage`; spends no credit and rejects a key whose usage has reached its limit |
| `search` | `exa` | `POST https://api.exa.ai/search` with one highlight result |

Brave and Exa have no free key check, so their validation spends one search request. `POST /api/credentials` accepts `validate: false` only for providers without a free check (Brave and Exa; any other provider returns `INVALID_INPUT`) to skip the call: the key is encrypted and saved with `status = unverified` and no `last_validated_at`. The Keys panel and onboarding offer this as a "Validate the key now" checkbox (on by default) for Brave and Exa, and an unverified key shows a Validate button that calls the revalidation endpoint. An unverified key is used for answers like any other; a wrong one fails at the first search.

`POST /api/credentials` takes `{ provider, key, ... }`. The stored kind is derived from the provider: `llm` for a provider with models (even when its key also serves search), `search` otherwise. It is kept as a column because it is bound into the ciphertext's AAD. A `kind` sent by an older client is accepted only if it agrees. Plan, expiry and budget are accepted only for providers with key limits (Brave). A stored key whose provider is no longer in the catalog is listed in Settings as unsupported and can only be deleted; its revalidation returns `INVALID_PROVIDER`.

## Envelope encryption

Each credential gets a fresh 32-byte data encryption key (DEK). The plaintext key is encrypted with AES-256-GCM under that DEK; the DEK is then wrapped by the configured KMS adapter.

Stored fields per credential:

```text
key_id, wrapped_dek, dek_nonce, dek_tag,
nonce, ciphertext, tag,
fingerprint, last4,
status, plan, expires_on, budget_usd, budget_period, budget_started_at,
last_validated_at
```

Additional authenticated data (AAD) for the credential ciphertext:

```text
beamling:v1:<userId>:<credentialId>:<kind>:<provider>
```

The KMS wrap uses a separate context:

```text
beamling:credential:v1:<userId>:<credentialId>:<kind>:<provider>
```

Both bind the ciphertext to the owner, credential id, kind and provider and are rebuilt on every decrypt. With the env adapter, `dek_nonce`/`dek_tag` hold the AES-GCM wrap; with AWS/GCP KMS they are empty because the KMS ciphertext blob carries its own integrity.

Display data:

- `fingerprint` = first 16 hex characters of HMAC-SHA256(plaintext) keyed with the `credential-fingerprint` HKDF subkey of `AUTH_SECRET`.
- `last4` = last four characters of the plaintext key when the key is at least 20 characters long; shorter keys store `••••` so the hint does not reveal a large part of the key.
- The API returns only id, kind, provider, last4, status, plan/limit metadata and validation time. The plaintext key is never returned after creation.

## Validation and status

Creating a credential validates it before saving unless the request sets `validate: false` ([Accepted credentials](#accepted-credentials)). A validation failure maps to a stable provider error and no row is written.

A saved credential can be revalidated with `POST /api/credentials/:id/validate`:

- The stored key is read with `readCredentialKey` ([Replace, delete, rotation](#replace-delete-rotation)). A decryption failure caused by KMS, network or configuration returns `PROVIDER_UNAVAILABLE` (503) and leaves the status unchanged. Only an integrity failure (`isDecryptIntegrityError`: AES-GCM authentication failure, AWS `InvalidCiphertextException` or GCP gRPC `INVALID_ARGUMENT`) sets `status = invalid` and returns `CREDENTIAL_UNREADABLE`.
- Success sets `status = active`.
- A rejected or out-of-credit key sets `status = invalid`.
- A rate-limited key sets `status = rate_limited`.
- Network errors and provider outages leave the existing status unchanged.

Status values exposed to the UI: `active`, `invalid`, `rate_limited`, `unverified`.

Credential operations are rate-limited to 20 per user per fixed hour. Every call that checks a key against its provider (create with validation, revalidate) also consumes the validation budget: 50 per account per fixed day and 120 per hashed client IP per fixed hour. The budget keeps the server from being used to test lists of leaked keys.

## Replace, delete, rotation

- Saving a credential validates it before writing.
- The route encrypts the new key first, then updates the existing `(user, kind, provider)` row in place. A KMS or database failure leaves the working credential and its usage history intact.
- Replacing a key keeps the credential id and daily usage. Concurrent replacements cannot rewrite the primary key; a losing different-id insert returns the row the first insert created.
- Fingerprints and Brave provider-slot keys are keyed HMACs, not bare SHA-256, so a database reader cannot test candidate keys offline. Unkeyed legacy fingerprints are no longer recognized.
- Saving and deleting a credential log `credential_saved` / `credential_deleted` audit events ([Logging and error handling](security.md#logging-and-error-handling)).
- Deleting a credential hard-deletes the row and its daily usage, and releases the matching Brave slot when the key can be decrypted. There is no recovery.
- Env-adapter master-key rotation:
  1. Deploy a new `CREDENTIAL_MASTER_KEY` with a new `CREDENTIAL_MASTER_KEY_ID`.
  2. Put the old key in `CREDENTIAL_PREVIOUS_MASTER_KEYS`.
  3. Run `node scripts/rewrap-credentials.mjs`.
  4. Remove the old key from the environment only after the script reports that no row still uses it.

The re-wrap script re-wraps both credential data keys (`key_id`, `wrapped_dek`, `dek_nonce`, `dek_tag`) and workspace keys in `user_data_keys` (`key_id`, `wrapped_key`, `wrap_nonce`, `wrap_tag`, `rotated_at`); provider-key ciphertext and content are untouched. It updates a row only while its old wrapped key still matches, so a row replaced or re-wrapped by the application during rotation is skipped. It then counts credentials and workspace keys still under an old master key; if any remain it prints the counts, tells the operator not to remove the old key, and exits with code 1.

For AWS/GCP, unwrap uses the stored `key_id` resource, so a new `KMS_KEY_NAME`/`KMS_KEY_ID` applies to new writes while old rows remain readable. Rows move to the new key lazily:

- Workspace keys are re-wrapped on the next read when the configured KMS key id changes.
- Provider keys are read through `readCredentialKey` (answers and revalidation). When the row's `key_id` differs from `currentKmsKeyId()`, it re-encrypts the key under the current KMS key with the same row id, so usage history stays. The update matches the old `wrapped_dek`, skipping a row replaced in the meantime; a failed re-wrap is ignored and retried on the next read.
- `currentKmsKeyId()` is async. With AWS it resolves `KMS_KEY_ID` to the key ARN once per process with `DescribeKey` (the AWS principal needs `kms:DescribeKey`), so an alias does not cause a re-wrap on every read or after a restart. If the lookup fails, rows are left as they are.

The script itself remains env-adapter only.

## Current data-protection boundary

| Data | At rest |
|---|---|
| Provider API keys | AES-256-GCM envelope ciphertext; DEK wrapped by the configured KMS |
| Workspace data key | 32 random bytes, wrapped by the configured KMS |
| Session token | SHA-256 hash only |
| Conversation titles | AES-256-GCM ciphertext under the account's workspace key |
| User and assistant message content | AES-256-GCM ciphertext under the account's workspace key |
| Source URL/title/domain/snippet | AES-256-GCM ciphertext under the account's workspace key |
| Search trace and model reasoning | AES-256-GCM ciphertext under the account's workspace key |

Content reads fail closed: a non-empty value without the `enc:v1:` envelope is rejected instead of being served as trusted plaintext. The only plaintext values tolerated are the empty string and the fixed synchronous `INTERRUPTED` message.
| Stored provider error messages | AES-256-GCM ciphertext; the fixed `INTERRUPTED` message remains plaintext |
| Usage counters and costs | Plaintext metadata |
| Request logs | Structured JSON; no request bodies or credentials; database parameters are not logged |

Content envelopes are `enc:v1:<base64url JSON>` with nonce, ciphertext, tag and key version. The AAD is `beamling:content:v1:<userId>:<table>:<rowId>:<field>`. Plaintext rows from before this change are still readable: any value without the `enc:v1:` prefix is returned as-is. The workspace key is cached per process (up to 500 accounts) after its first KMS unwrap.

Every account gets a `user_data_keys` row on first sign-in. Deleting the account cascades the wrapped key and content rows. A database-only compromise still yields ciphertext, but the application process can decrypt content for the owning account; this is not end-to-end encryption.

## Search-provider limits

- Brave keys require a user-declared plan: `free` or `paid`.
- `free` uses `BRAVE_MIN_INTERVAL_MS` (default 1,100 ms) per key across instances.
- `paid` uses `BRAVE_PAID_MIN_INTERVAL_MS` (default 0).
- Optional `expires_on`, `budget_usd` and `budget_period` (`month` or `total`) are stored as user-declared metadata. The Brave API is not queried for them. Tavily and Exa currently store only the credential and daily request/cost usage; provider-plan metadata is Brave-only.
- `credential_usage` stores daily requests and estimated cost. `listCredentials` sums the current month or all time and exposes `spentUsd`, `requests` and a warning: `budget_100`, `budget_80`, `expiry_1`, `expiry_7` or `expiry_14`.
- A warning never blocks a search. Provider `402` remains authoritative.
- The UI labels the limits as set by the user, not as provider facts.
