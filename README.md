# Beamling

Beamling is an answer engine that uses your own model and search keys. It searches the web, works through the results, and returns cited answers with sources you can inspect.

Your models. Your search. Your bill.

- **Hosted:** [beamling.app](https://beamling.app)
- **Documentation:** [davidemodolo.github.io/beamling](https://davidemodolo.github.io/beamling/) (sources in [`docs/`](docs/))

## Highlights

- Bring your own keys: OpenRouter or DeepSeek for models; Brave, Tavily, Exa or DeepSeek for search (one DeepSeek key covers both)
- Quick, Deep and Deeper modes, from a single search to an agentic loop with up to 60 searches
- Streamed answers with numbered citations and an inspectable source panel
- Keys and conversation content encrypted at rest with KMS-backed envelope encryption
- Self-service data export, analytics opt-out and account deletion

The full feature list is on the [documentation home](https://davidemodolo.github.io/beamling/).

## Quick start

```sh
pnpm install
pnpm local:up        # production-parity stack at https://localhost
pnpm test
```

See [Development](https://davidemodolo.github.io/beamling/development/) for the dev loop, tests, releases and the docs site.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Beamling is open source under the [MIT License](LICENSE). Third-party dependencies keep their own licenses; the inventory is generated with `pnpm licenses:generate` and shown on the `/licenses` page.
