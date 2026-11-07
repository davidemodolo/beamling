# Key Management

Credentials use KMS-backed envelope encryption; workspace content uses per-account keys. Current boundary: [Snapshot](index.md#snapshot) and [Credentials](../reference/credentials.md).

## Scheme

Envelope encryption with a pluggable master key provider, selected by `KMS_PROVIDER`:

| `KMS_PROVIDER` | Use | Settings |
|---|---|---|
| `gcp` | Production default | `KMS_KEY_NAME`, Application Default Credentials/Workload Identity |
| `aws` | Local parity (LocalStack) | `KMS_KEY_ID`, `AWS_REGION`, `KMS_ENDPOINT` |
| `env` | Localhost and tests only; production refuses it | 256-bit `CREDENTIAL_MASTER_KEY` plus a version id |

1. Generate a 256-bit DEK per credential.
2. Encrypt the credential with AES-256-GCM under the DEK.
3. Wrap the DEK with the master key provider.
4. Store wrapped DEK, nonce, ciphertext and tag in `credentials`.
5. Decrypt only in the request that needs it; zeroize buffers after use.

Steps 1–4 are implemented. Step 5 is target hardening (no explicit zeroization yet).

`AAD = "beamling:v1:" || userId || ":" || credentialId || ":" || kind || ":" || provider` prevents ciphertext swaps.

The format must allow re-wrapping without bulk decryption. A cloud KMS is required before public launch. Docs and UI state the key-storage assurance level.

Key validation:

- OpenRouter: `GET https://openrouter.ai/api/v1/key`. Reject `401`; record label, limits, usage. Never validate with a paid completion.
- Brave: one search, `count=1`. Reject `401`; surface `402` and `429` distinctly.
- Tavily: `GET /usage` (free). Reject `401`; usage at or above a non-null limit → `QUOTA_EXCEEDED`; `429` → rate limited.
- Exa: one `POST /search`, `numResults=1`, `type=auto`, `contents={highlights:true}`. Reject `401`/`403`; `402` → insufficient credits; `429` → rate limited.

## Fingerprint and display

- `fingerprint = HMAC-SHA256(plaintext)` with an `AUTH_SECRET` subkey, truncated to 16 hex chars (no offline key testing).
- Show only the last four characters, and only for keys of 20+ characters (`sk-...7Q2F`).
- Never show the full key, its length or more than four characters.

## Lifecycle

| Event | Behavior |
|---|---|
| Create | Validate, then encrypt and store |
| Validate | Minimal provider call. Limits: 20 credential operations/user/hour, 50 key checks/user/day, 120/IP/hour. KMS or network failure leaves status unchanged |
| Replace | New record; old one deleted immediately |
| Delete | Hard delete; no recovery |
| Rotation warning | After 30 days without validation |

## Rules

- Never log request or response headers.
- Never put plaintext keys in errors, stack traces or analytics.
- Never send keys to the browser after creation.
- Use a key only for its owner, and only for jobs the owner started.
- Never fall back to a weaker KMS adapter. Fail closed.

## Search-key plan, expiry and budget metadata

**User-declared**, not read from the provider.

| Field | Storage | Rules |
|---|---|---|
| Brave plan | `credentials.plan` (`free`/`paid`) | Required for Brave; UI default `free`. `free` enforces 1 request/second per key. |
| Expiry | `credentials.expires_on` (`date`, nullable) | Must be in the future. Warnings at 14/7/1 days. |
| Budget | `credentials.budget_usd` (`numeric(12,2)`, nullable), monthly | Positive USD. Warn at 80% and 100% of usage since month start (or since set). |
| Usage | `credential_usage` per credential per day: requests, estimated cost | Updated atomically after each search, free plan included. |

- The UI labels these fields **set by you**.
- Same fingerprint on replace keeps fields and usage period; a new one starts a new period.
- Warnings never block a search; the provider's `402` is authoritative.
- Warnings are per credential, dismissible per day/threshold, and never include the key.

## Workspace data encryption (public-launch target)

Implemented. Each workspace has a 256-bit workspace data key (WDK), stored wrapped in `user_data_keys`. Content is encrypted before reaching PostgreSQL, so a dump, backup, replica or read-only compromise shows only ciphertext. Credentials use [Scheme](#scheme).

**Encrypted:** conversation titles; messages; source URL, title, domain, snippet; search trace (query, status, result count); model reasoning; stored errors that may echo user content.

**May stay plaintext** (never user text): ids and foreign keys; flags; timestamps; role, mode, status and error codes; provider and kind; model ids and upstream providers; token, cost, latency and search counters; source positions and dates; fingerprint, last-4 and wrapped-key metadata; session-token hashes; hashed rate-limit and slot keys.

**Scheme**

1. Generate a random 256-bit WDK on workspace creation.
2. Wrap it; store wrapped WDK, nonce/tag, key version and timestamps in `user_data_keys`.
3. Encrypt each payload with AES-256-GCM and a fresh 96-bit nonce; store nonce, ciphertext, tag and key version with the row (one JSON payload per row is fine).
4. `AAD = userId || table || rowId || field || keyVersion`.
5. Decrypt per row, only for the authenticated owner. Lists decrypt only returned rows.
6. Zeroize keys and plaintext. Never write plaintext to logs, analytics, error trackers or temp files.
7. Never filter, order, index or hash on content columns. Content checks (e.g. default title) run after decryption or use a non-content boolean.

**Boundary**

- A database-only breach cannot read content; the master key is outside the database.
- Not end-to-end: the app decrypts to search, prompt and stream. Never call it E2E.
- Metadata (counts, timestamps, model ids, token/cost totals, statuses) stays visible.

**Key lifecycle**

- The master key is versioned; re-wrapping a WDK never re-encrypts content.
- WDK rotation is lazy (re-encrypt on write, optional backfill). Ciphertext carries its key version.
- Workspace deletion removes rows and the wrapped WDK in one transaction ([Delete account and data](scope.md#delete-account-and-data)). Backups expire within 30 days ([Retention](data-model.md#retention)).
- If a key is unavailable, fail closed; never write or return plaintext.

**Migration and verification**

- No plaintext content at public launch. A one-off migration creates WDKs, encrypts existing rows and checks a raw dump. This check is a release gate.
- Tests: raw `pg_dump` has no question/answer/source strings; workspace A ciphertext fails under B; master-key change re-wraps without changing content ciphertext; account deletion removes WDK and rows.

**Privacy copy**

- The privacy/security page states what is encrypted, what metadata is visible, and that it is not E2E.
