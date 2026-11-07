# Product

## Executive Summary

Beamling is a web application that gives users a Perplexity-style answer experience while letting them bring their own API keys for the language model and the web search provider.

The product sits between two existing options:

- **Self-hosted open-source answer engines** (Vane/Perplexica, Morphic, Farfalle, SurfSense) give control but require deployment, updates, authentication, storage, and operational work.
- **Hosted AI answer services** (Perplexity and similar) provide a polished experience but hide the model, the provider, and the cost, and do not let users bring their own keys.

Beamling is the managed middle ground: a hosted product with a clean interface, no infrastructure work for the user, and full provider choice through BYOK. At launch the product is free: users sign in with Google, connect their keys, and use it. Monetization is deliberately deferred and may later take the form of a hosting subscription, prepaid credits, token resale, or optional donations.

---

## Problem Statement

### User problems

1. **Setup burden.** Running an open-source answer engine requires Docker, a database, environment variables, authentication, backups, and ongoing upgrades. Most users who want cited AI answers do not want to operate infrastructure.
2. **Loss of control.** Hosted answer services choose the model, the search index, and the retrieval policy. Users cannot use the models they already pay for, cannot choose their search provider, and cannot audit where answers come from.
3. **Opaque cost.** Subscription answer products bundle model usage into a flat fee. Heavy users overpay; light users subsidize them. Power users already hold API keys and want to use them.
4. **Trust gap.** Answers without visible, inspectable sources are hard to verify. Citation quality and source transparency are the core of trustworthy AI search.
5. **Privacy concerns.** Sending every query to a single vendor creates a single point of data exposure. BYOK lets users choose providers with terms they accept.

### Market gap

| Category | Examples | Managed | BYOK | Cited answers | Self-host required |
|---|---|---|---|---|---|
| Hosted answer engines | Perplexity, You.com, Phind | Yes | No | Yes | No |
| OSS answer engines | Vane/Perplexica, Morphic, Farfalle, SurfSense | No | Yes | Yes | Yes |
| BYOK chat clients | Open WebUI, LobeChat, Chatbox | Sometimes | Yes | Partial | Often |
| **Beamling** | — | **Yes** | **Yes** | **Yes** | **No** |

The gap is a managed, search-first, citation-first product with BYOK. The closest alternatives are either self-hosted or not search-first.

---

## Goals and Non-Goals

### Goals

| ID | Goal | Success signal |
|---|---|---|
| G1 | Ask a question and receive a grounded, cited answer in Quick, Deep or Deeper mode | Quick: p95 first token under 3 s, full answer under 12 s. Deep: progress visible within 1 s, full report under 45 s p95 / 90 s max. Deeper: each search visible within 1 s, report under 6 min |
| G2 | Prove the BYOK pipeline with OpenRouter and three search adapters in Alpha 1, then add LLM providers without changing the core | OpenRouter and Brave, Tavily and Exa contract tests pass; the adapter interface supports at least three LLM and three search providers at public launch |
| G3 | Keep user keys confidential | No plaintext key in logs, database dumps, client payloads, or error reports |
| G4 | Reach a first cited answer in under three minutes from first visit | Onboarding funnel measurement |
| G5 | Make cost and provider transparent | Every answer shows provider, resolved model, token counts and actual cost when the provider returns it |
| G6 | Work well on desktop and mobile web | WCAG 2.2 AA; no horizontal scroll at 360 px |
| G7 | Stay minimal, fast, and cheap to run | One deployable service, no mandatory auxiliary services, idle footprint under 512 MB |

### Non-goals for v1

- A supported self-hosted distribution. The app is still packaged as a Docker image for deployment and local development.
- Team workspaces, role-based access control, and shared billing.
- Model fine-tuning or training.
- Native iOS or Android applications.
- An in-house web crawler or search index.
- Model hosting or inference resale.
- Voice input and voice answers.
- Autonomous agents that act on external systems.
- A general-purpose chat platform or workbench: no plugin marketplace, no multi-model comparison UI, no team chat. Beamling is a focused answer engine, not an Open WebUI replacement.

These may become v2+ work, but they are explicitly out of scope for the first release.

---

## Target Users and Personas

### P1 — The AI power user

- Already pays for OpenAI, Anthropic, or Google API access.
- Uses Perplexity or ChatGPT daily and wants more control over model choice and cost.
- Cares about citations, export, and the ability to switch providers.
- Willing to paste an API key if the value is obvious.

### P2 — The privacy-conscious professional

- Consultant, lawyer, researcher, or analyst.
- Cannot send client material to an unknown vendor without a data-processing agreement.
- Wants provider choice and minimal retention.
- Values a calm, credible interface over novelty.

### P3 — The indie developer

- Builds with LLM APIs and wants a polished answer engine without building one.
- Appreciates a clean API, exports, and transparent usage.
- Likely to become an advocate if onboarding is fast.

### P4 — The small team (later)

- 3–20 people who want shared history and provider policy.
- Not in the first release; the data model should not block it.

---

## Jobs to Be Done

1. **When I need a quick answer I can trust**, I want to ask in natural language and see exactly which source supports each claim, so I can verify it without opening ten tabs.
2. **When I already pay for API access**, I want to use my keys in a great interface, so I do not pay twice for the same capability.
3. **When I research a topic**, I want follow-up questions, source management, and exports, so the work survives the session.
4. **When I care about privacy**, I want to choose my providers and delete my data, so I stay in control.
5. **When an answer is wrong or thin**, I want to see the sources and the model that produced it, so I can judge the failure.

---

## Product Principles

1. **Sources first.** A factual claim without a citation is a bug. The answer is the map; the sources are the territory.
2. **Your keys, your models.** Beamling never proxies model or search traffic through a shared account. The user's credential is the credential.
3. **Calm interface.** Light is a tool, not decoration. The UI stays quiet so the answer and its evidence dominate.
4. **Transparency by default.** Show the resolved model, search provider, token counts and provider-reported cost on every answer, with estimates clearly labeled.
5. **Privacy is a feature.** Beamling does not train on user data. Model and search providers' policies are disclosed, not assumed. Minimal retention, keys encrypted at rest, clear deletion.
6. **Fast beats clever.** Stream the answer, render sources as they arrive, and never block the first token on non-essential work.
7. **No silent fallbacks.** If the chosen provider fails, say so. Do not spend the user's money on a different provider without consent.
8. **Minimal by default.** Every dependency, service, and feature must justify its weight. One deployable service, standard components, no platform bloat.
9. **Stateless and portable.** Application servers hold no durable state. Persistence lives in the managed database; any instance can serve any request.
10. **Show the search.** Beamling's mascot is the visible state machine for queued, searching, reading and writing. Motion communicates real pipeline progress, never fake progress, and never blocks the answer.

---

## Brand: Beamling

### Name

**Beamling** is a coined word: *beam* + *-ling* (the diminutive suffix in duckling and earthling). It reads as "a small beam of light." It is easy to pronounce in English and Italian, short enough for a wordmark, and distinct from existing AI product names.

Initial checks on 2026-10-19:

- `beamling.app` is the chosen primary domain. `beamling.ai`, `beamling.co`, `beamling.io`, `beamling.page` and `beamling.dev` are available as defensive registrations.
- `beamling.com` is registered but does not serve a live site; it appears to be a holding registration.
- No exact BEAMLING trademark filing surfaced in initial searches. A formal clearance search in classes 9 and 42 is required before filing.
- The only prior use found is an informal, user-created asset name in the BeamNG.drive/BeamMP modding community. It is not a company, product line, or registered mark.

### Voice and tone

- Warm, precise, and calm.
- Never overconfident. Prefer "The sources suggest..." over "It is certain..."
- Admit insufficient evidence plainly.
- No exclamation marks in system-generated copy.
- Example microcopy:
  - Empty state: "Ask anything. Beamling will show you where the answer comes from."
  - No sources: "I found an answer, but not enough reliable sources to support it."
  - Invalid key: "That key was rejected by the provider. Check it and try again."
  - Rate limit: "The provider is rate-limiting this key. Try again in a moment."

### Tagline options

1. A little light on every answer.
2. Ask. See the sources.
3. Your keys. Your models. Clear answers.

### Visual identity

| Token | Value | Use |
|---|---|---|
| Ink | `#0A0C10` | Page background |
| Surface | `#121620` | Cards, sidebar |
| Surface raised | `#1A1F2B` | Menus, popovers |
| Beam | `#FFC86B` | Primary accent |
| Beam soft | `#FFE3B0` | Highlights, citation glow |
| Accent | `#6EE7F9` | Links, focus rings |
| Text | `#F4F1EA` | Primary text |
| Muted | `#9AA3B2` | Secondary text |
| Success | `#4ADE80` | Valid key, completed |
| Error | `#F87171` | Failures, invalid key |

Typography: **Inter** for UI and body, **JetBrains Mono** for code and token counts. Both are open-source and safe for commercial use.

Logo: a wordmark in Inter SemiBold. The accompanying mark is to be defined.
