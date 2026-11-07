# Beamling agent notes

- When building anything, always use the latest stable version of libraries and services. Check the current version before pinning or installing instead of relying on memory.

## Documentation

The documentation is an MkDocs site in `docs/` (config in `mkdocs.yml`), published to GitHub Pages.

- `docs/spec/` is the target product and technical contract, not a description of the current checkout.
- `docs/reference/` documents what the current code does. Read the relevant page before changing routes, schema, environment variables, providers, limits, auth, streaming, UI, deployment, or security behavior, and update it in the same change.
- Keep the two distinct: do not put planned or unimplemented behavior in `docs/reference/` as if it were current.
- If code and the spec disagree, the code is the current source of truth; update the snapshot in `docs/spec/index.md` or the relevant requirement status.
- New pages must be added to `nav` in `mkdocs.yml`. `mkdocs build --strict` (run in CI) fails on broken links, missing anchors and pages outside the nav.

## Local verification

- Use `pnpm local:up` for auth, KMS, TLS and other production-path changes. The parity stack runs Dex OIDC, LocalStack KMS, TLS PostgreSQL and the production image.
- `BEAMLING_FAKE_PROVIDERS=1` and `/api/auth/test-login` are test-only. Do not use them to judge production behavior.
