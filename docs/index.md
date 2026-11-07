# Beamling

An answer engine that uses your own model and search keys. It searches the web and returns cited answers.

*Your models. Your search. Your bill.*

Hosted at [beamling.app](https://beamling.app). Source on [GitHub](https://github.com/davidemodolo/beamling), MIT License.

## Where to read

| You want to… | Read |
|---|---|
| Run, test or release the code | [Development](development.md) |
| Know what the code does today | [Technical reference](reference/index.md) |
| Know what the product aims to become | [Product specification](spec/index.md) |
| Deploy or operate it | [Deployment and operations](reference/operations.md) |
| Report a vulnerability | [Security policy](https://github.com/davidemodolo/beamling/blob/main/SECURITY.md) |

Where the reference and the specification disagree, the code wins and the [snapshot](spec/index.md#snapshot) records the gap.

## Features

- Google sign-in only
- Your own keys: OpenRouter or DeepSeek for models; Brave, Tavily, Exa or DeepSeek for search
- Keys and conversations encrypted at rest (KMS envelope encryption)
- Search provider chosen per answer; Brave plan, expiry and budget warnings
- Quick, Deep and Deeper modes (Deeper: up to 60 searches)
- Streamed answers with numbered citations, sources, search and reasoning panels
- History with pinning and search; 60-day retention, 100 chats per account
- Terms acceptance with 18+ confirmation
- JSON export, analytics opt-out, sign out everywhere, account deletion
- Unused accounts deleted after 24 months (7 days if terms never accepted)
- Legal pages, `security.txt` and DSA contact
- Optional server-side analytics, metadata only
- Production-parity local stack
