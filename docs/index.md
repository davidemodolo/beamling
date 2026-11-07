# Beamling

Beamling is an answer engine that uses your own model and search keys. It searches the web, works through the results, and returns cited answers with sources you can inspect.

*Your models. Your search. Your bill.*

The hosted service runs at [beamling.app](https://beamling.app). The source is on [GitHub](https://github.com/davidemodolo/beamling) under the MIT License.

## Where to read

| You want to… | Read |
|---|---|
| Run, test or release the code | [Development](development.md) |
| Know what the code does today | [Technical reference](reference/index.md) |
| Know what the product aims to become | [Product specification](spec/index.md) |
| Deploy or operate it | [Deployment and operations](reference/operations.md) |
| Report a vulnerability | [Security policy](https://github.com/davidemodolo/beamling/blob/main/SECURITY.md) |

The technical reference describes the current code; the specification is the target contract. Where they disagree, the code wins and the specification's [snapshot](spec/index.md#snapshot) records the gap.

## Features

- Google-only accounts; no guest workspaces
- Bring your own keys: OpenRouter or DeepSeek for models, Brave, Tavily, Exa or DeepSeek for search (one DeepSeek key covers both)
- Keys and conversation content encrypted at rest through KMS-backed envelope encryption
- Choose the search provider per answer; Brave Free/Paid plan plus optional expiry and budget warnings
- Quick for one search pass, Deep for planned multi-query research, Deeper for an agentic loop with up to 60 searches
- Streamed answers with inline, numbered citations
- Collapsed panels for the searches actually run and any model-provided reasoning
- Markdown tables, headings, lists, quotes and code
- Source panel with titles, domains, snippets, and publication dates
- Conversation history with pinned chats, title search and per-conversation deletion; 60-day retention and 100 chats per account
- Model, default search-provider and default-mode settings
- Terms acceptance on first use and after every material change, with an 18+ confirmation
- Your data in Settings: download everything as JSON, opt out of product analytics (and erase what was collected), sign out everywhere, delete the account
- Automatic deletion of accounts unused for 24 months or never accepted after 7 days
- Privacy notice, terms, cookie policy, data processors, security policy with `security.txt`, and DSA contact page
- Optional server-side PostHog analytics with metadata-only allowlisted events, no browser SDK and account-deletion cleanup
- Production-parity local stack with HTTPS, OIDC, KMS and TLS PostgreSQL
- Open source under the MIT License
