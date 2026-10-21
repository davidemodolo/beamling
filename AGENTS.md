# Beamling — agent notes

- When building anything, always use the latest stable version of libraries and services. Check the current version before pinning or installing instead of relying on memory.

## Documentation

- `SPEC.md` is the target product and technical contract, not a description of the current checkout.
- `TECHNICAL.md` documents what the current code does. Read the relevant section before changing routes, schema, environment variables, providers, limits, auth, streaming, UI, deployment, or security behavior, and update it in the same change.
- Keep the two documents distinct: do not put planned or unimplemented behavior in `TECHNICAL.md` as if it were current.
- If code and `SPEC.md` disagree, the code is the current source of truth; update the implementation snapshot in `SPEC.md` §0 or the relevant requirement status.

## Local verification

- Use `pnpm local:up` for auth, KMS, TLS and other production-path changes. The parity stack runs Dex OIDC, LocalStack KMS, TLS PostgreSQL and the production image.
- `BEAMLING_FAKE_PROVIDERS=1` and `/api/auth/test-login` are test-only. Do not use them to judge production behavior.
