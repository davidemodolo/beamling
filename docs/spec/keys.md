# Key Management

The current checkout implements KMS-backed envelope encryption for credentials and per-account workspace content keys. The env adapter remains for tests. The current data boundary is stated in [Snapshot](index.md#snapshot) and the [technical reference](../reference/index.md).

## Scheme

Envelope encryption with a pluggable master key provider. The code has adapters for GCP Cloud KMS (production), AWS KMS (local parity through LocalStack) and an environment-held master key (tests and offline development only).

`KMS_PROVIDER` selects the adapter. `KMS_PROVIDER=gcp` uses GCP Cloud KMS with `KMS_KEY_NAME` and Application Default Credentials/Workload Identity. `KMS_PROVIDER=aws` uses the AWS KMS API with `KMS_KEY_ID`, `AWS_REGION` and `KMS_ENDPOINT`; the local parity stack points the endpoint at LocalStack. `KMS_PROVIDER=env` is only allowed on localhost or in tests. Production startup refuses `env`.

1. Generate a 256-bit data encryption key (DEK) per credential.
2. Encrypt the credential with AES-256-GCM using the DEK.
3. Wrap the DEK with the master key provider.
4. Store the wrapped DEK, nonce, ciphertext, and tag in `credentials`.
5. Decrypt only inside the request that needs the credential. Zeroize buffers after use.

Steps 1–4 are implemented for credentials in the current checkout. Step 5 is target hardening; the current code relies on process memory lifetime rather than explicit buffer zeroization.

Additional authenticated data binds a credential to its owner, id, kind and provider: `AAD = "beamling:v1:" || userId || ":" || credentialId || ":" || kind || ":" || provider`. This prevents ciphertext swapping between records.

The production default is GCP Cloud KMS. The local parity stack uses the same wrap/unwrap interface against LocalStack KMS. The environment-key adapter remains for tests only, with a 256-bit `CREDENTIAL_MASTER_KEY` secret and a version identifier. The ciphertext format must permit later re-wrapping without decrypting keys in bulk. A cloud KMS is required before public launch. Documentation and the UI must state the key-storage assurance level.

Key validation calls:

- OpenRouter: `GET https://openrouter.ai/api/v1/key` with the user key. Reject `401`; record label, limits and usage. Do not validate with a paid completion.
- Brave: one Web Search request with `q` and `count=1`. Reject `401`; surface `402` and `429` distinctly.
- Tavily: `GET /usage`, which spends no credit. Reject `401`; map a usage at or above a non-null limit to `QUOTA_EXCEEDED`, and `429` to rate limiting.
- Exa: one `POST /search` with a short probe, `numResults=1`, `type=auto`, `contents={highlights:true}`. Reject `401`/`403`; map `402` to insufficient credits and `429` to rate limiting.

## Fingerprint and display

- Store `fingerprint = HMAC-SHA256(plaintext)` keyed with a subkey of `AUTH_SECRET`, truncated to 16 hex characters, so a database reader cannot test candidate keys offline.
- Display only the last four characters, and only for keys of at least 20 characters (for example `sk-...7Q2F`); shorter keys show no characters.
- Never display the full key, length, or prefix beyond four characters.

## Lifecycle

| Event | Behavior |
|---|---|
| Create | Validate first, then encrypt and store |
| Validate | Minimal provider call; current API allows 20 credential operations per user per hour plus 50 provider key checks per user per day and 120 per IP per hour, not a per-credential 60-second limit. A KMS or network failure while reading the key leaves its status unchanged |
| Replace | Create new record, delete old record immediately |
| Delete | Hard-delete the row; no soft delete, no recovery |
| Rotation warning | UI warns when a key has not been validated for 30 days |

## Rules

- Never log request or response headers.
- Never include plaintext keys in error messages, stack traces, or analytics.
- Never send keys to the browser after creation.
- Never use a key for any user other than its owner.
- Never use a key for background jobs that the owner did not initiate.
- Never fall back to a weaker KMS adapter when the configured one is unavailable. Fail closed.

## Search-key plan, expiry and budget metadata

These fields are **user-declared**, not provider-verified. The Brave validation API does not expose the plan, the remaining budget or the key's expiry date.

| Field | Storage | Rules |
|---|---|---|
| Brave plan | `credentials.plan` (`free` or `paid`) | Required for Brave keys; defaults to `free` in the UI. `free` enforces 1 request/second per key. |
| Expiry | `credentials.expires_on` (`date`, nullable) | Must be in the future when set. Displayed with 14/7/1-day warnings. |
| Budget | `credentials.budget_usd` (`numeric(12,2)`, nullable), monthly | Positive USD amount. Sum estimated usage from the start of the month (or from when the budget was set); warn at 80% and 100%. |
| Usage | `credential_usage` rows per credential per day: requests and estimated cost | Updated atomically after a search request. Free-plan requests still count. |

Rules:

- The UI labels all four fields as **set by you**, never as values read from the provider.
- Replacing a key with the same fingerprint preserves the fields and usage period. A different fingerprint starts a new usage period.
- A warning is informational. Do not block a search because of a declared limit; the provider may still accept it, and the provider's `402` remains authoritative.
- Warnings are per credential and dismissible for the current day/threshold. They never include the plaintext key.

## Workspace data encryption (public-launch target)

Every workspace gets its own 256-bit workspace data key (WDK). All user content is encrypted at the application layer before it is written to PostgreSQL, so a database dump, backup, read replica, or read-only database compromise reveals ciphertext, not conversations, questions, answers, sources or titles.

This section is implemented. The current checkout has a `user_data_keys` table and encrypts conversation titles, message content, source fields and stored provider errors. Credentials use the separate envelope scheme in [Scheme](#scheme).

**What is encrypted**

- Conversation titles.
- User and assistant message content.
- Source URL, title, domain and snippet.
- The search trace (query text, status and result count).
- Model-provided reasoning.
- Any stored error message that may contain provider-echoed user content.

Credentials keep their existing per-credential envelope encryption ([Scheme](#scheme)) and are never stored in plaintext. The following operational fields may remain plaintext; none may contain user text: UUIDs and foreign keys; account/status flags; timestamps; role, mode, status and error codes; provider and kind; selected/resolved model ids and upstream provider names; token, cost, latency, search-request and search-failure counters; source positions and publication dates; credential fingerprint, last-4 suffix and wrapped-key metadata; session-token hashes; hashed rate-limit and provider-slot keys.

**Scheme**

1. On workspace creation, generate a random 256-bit WDK.
2. Wrap the WDK with the master key provider. Store the wrapped WDK, wrapping nonce/tag, key version and created/rotated timestamps in a `user_data_keys` table (or an equivalent key table).
3. Encrypt each content payload with AES-256-GCM using the WDK and a fresh 96-bit nonce. Store the nonce, ciphertext, tag and key version alongside the row. A single encrypted JSON payload per row is acceptable; separate columns per field are not required.
4. Bind the ciphertext with `AAD = userId || table || rowId || field || keyVersion`. This prevents ciphertext swapping between users, rows or fields.
5. Decrypt only inside a request authenticated as the owning workspace, per row. Never bulk-decrypt the database for a list endpoint; list endpoints decrypt only the rows they return.
6. Zeroize keys and plaintext buffers after use. Never write plaintext to logs, analytics, error trackers or temporary files.
7. Content columns are never used in SQL filters, ordering, indexes or deterministic hashes. Rows are selected by ids, foreign keys and plaintext metadata. Content equality checks (for example the default-title check) happen after decryption or via a non-content boolean.

**Security boundary**

- A database-only breach is insufficient to read content: the master key lives in the KMS/environment, not in the database. The wrapped WDK in a dump is useless without it.
- This is not end-to-end encryption. The application process decrypts content to search, prompt and stream; a full application/server compromise with master-key access can read content. Do not describe the product as E2E encrypted.
- Metadata (row counts, timestamps, model ids, token/cost totals, statuses) remains visible in a database dump. Do not claim that all metadata is hidden.

**Key lifecycle**

- The master key is versioned. Re-wrapping a WDK under a new master key must not require re-encrypting user content.
- Rotating a WDK is lazy: re-encrypt on write, with a background backfill if required. Every ciphertext carries its key version.
- On workspace deletion, delete the content rows and the wrapped WDK in the same transaction ([Delete account and data](scope.md#delete-account-and-data)). Backups expire within 30 days ([Retention](data-model.md#retention)).
- If the WDK or master key is unavailable, fail closed: never fall back to writing or returning plaintext.

**Migration and verification**

- The first public release must not contain plaintext content. A one-off migration creates a WDK for every existing workspace, encrypts any existing plaintext rows before launch, and verifies that a raw dump contains no readable user content.
- That verification is a release gate, not a manual spot check.
- Tests: assert that a raw `pg_dump` contains none of the question/answer/source strings; assert ciphertext from workspace A fails under workspace B; assert a master-key version change re-wraps without changing the content ciphertext; assert account deletion removes the WDK and rows.

**Privacy copy**

- The public privacy/security page must state exactly what is encrypted, what metadata remains visible, and that the design is not end-to-end encrypted. Do not claim that a full server compromise cannot read content.
