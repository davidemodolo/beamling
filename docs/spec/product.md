# Product

## Executive Summary

Beamling is a hosted, Perplexity-style answer engine where users bring their own model and search API keys.

- **Self-hosted OSS answer engines** (Vane/Perplexica, Morphic, Farfalle, SurfSense) give control but need deployment and operations.
- **Hosted answer services** (Perplexity and similar) are polished but hide model, provider and cost, and don't accept user keys.

Beamling is the middle ground: hosted, no infrastructure for the user, full provider choice. It is free at launch (sign in with Google, add keys). Monetization is deferred: possibly hosting subscription, prepaid credits, token resale or donations.

---

## Problem Statement

### User problems

1. **Setup burden.** Self-hosting needs Docker, a database, auth, backups and upgrades.
2. **Loss of control.** Hosted services pick the model, index and retrieval policy; users can't use their own keys or audit sources.
3. **Opaque cost.** Flat fees make heavy users overpay and light users subsidize them.
4. **Trust gap.** Answers without inspectable sources are hard to verify.
5. **Privacy.** One vendor sees every query. BYOK lets users pick providers whose terms they accept.

### Market gap

| Category | Examples | Managed | BYOK | Cited answers | Self-host required |
|---|---|---|---|---|---|
| Hosted answer engines | Perplexity, You.com, Phind | Yes | No | Yes | No |
| OSS answer engines | Vane/Perplexica, Morphic, Farfalle, SurfSense | No | Yes | Yes | Yes |
| BYOK chat clients | Open WebUI, LobeChat, Chatbox | Sometimes | Yes | Partial | Often |
| **Beamling** | This project | **Yes** | **Yes** | **Yes** | **No** |

No managed, search-first, citation-first BYOK product exists.

---

## Goals and Non-Goals

### Goals

| ID | Goal | Success signal |
|---|---|---|
| G1 | Grounded, cited answers in Quick, Deep or Deeper mode | Quick: p95 first token < 3 s, full answer < 12 s. Deep: progress within 1 s, report < 45 s p95 / 90 s max. Deeper: each search visible within 1 s, report < 6 min |
| G2 | BYOK pipeline with OpenRouter and three search adapters in Alpha 1; add LLM providers without changing the core | OpenRouter, Brave, Tavily and Exa contract tests pass; interface supports ≥ 3 LLM and ≥ 3 search providers at public launch |
| G3 | Keep user keys confidential | No plaintext key in logs, dumps, client payloads or error reports |
| G4 | First cited answer < 3 minutes from first visit | Onboarding funnel |
| G5 | Transparent cost and provider | Every answer shows provider, resolved model, tokens and actual cost when reported |
| G6 | Desktop and mobile web | WCAG 2.2 AA; no horizontal scroll at 360 px |
| G7 | Minimal, fast, cheap to run | One service, no mandatory auxiliary services, idle < 512 MB |

### Non-goals for v1

- Supported self-hosted distribution (a Docker image still exists for deployment and development).
- Team workspaces, RBAC, shared billing.
- Fine-tuning or training.
- Native mobile apps.
- In-house crawler or index.
- Model hosting or inference resale.
- Voice.
- Agents that act on external systems.
- General chat platform: no plugin marketplace, multi-model comparison or team chat.

---

## Target Users and Personas

### P1: The AI power user

- Pays for OpenAI, Anthropic or Google API access; uses Perplexity or ChatGPT daily.
- Wants control over model and cost, citations, export, provider switching.

### P2: The privacy-conscious professional

- Consultant, lawyer, researcher or analyst; can't send client material to unknown vendors without a DPA.
- Wants provider choice, minimal retention, a calm credible interface.

### P3: The indie developer

- Builds with LLM APIs; wants a polished answer engine, clean API, exports, transparent usage.

### P4: The small team (later)

- 3–20 people wanting shared history and provider policy. Not in v1; the data model must not block it.

---

## Jobs to Be Done

1. **Quick trustworthy answer:** see which source supports each claim.
2. **Already paying for API access:** use my keys instead of paying twice.
3. **Research:** follow-ups, source management and exports that outlast the session.
4. **Privacy:** choose providers and delete my data.
5. **Wrong or thin answer:** see the sources and model behind it.

---

## Product Principles

1. **Sources first.** An uncited factual claim is a bug.
2. **Your keys, your models.** No shared accounts; the user's credential is used.
3. **Calm interface.** The answer and its evidence dominate.
4. **Transparency by default.** Show model, search provider, tokens and reported cost on every answer; label estimates.
5. **Privacy is a feature.** No training on user data, provider policies disclosed, minimal retention, encrypted keys, clear deletion.
6. **Fast beats clever.** Stream; never block the first token on non-essential work.
7. **No silent fallbacks.** If the chosen provider fails, say so; never spend the user's money on another provider without consent.
8. **Minimal by default.** One service, standard components.
9. **Stateless and portable.** All durable state is in the managed database; any instance serves any request.
10. **Show the search.** The mascot reflects real pipeline state (queued, searching, reading, writing), never fake progress, and never blocks the answer.

---

## Brand: Beamling

### Name

*beam* + *-ling*: "a small beam of light." Easy in English and Italian, short, distinct from other AI names.

Checks on 2026-10-19:

- Primary domain `beamling.app`; `.ai`, `.co`, `.io`, `.page`, `.dev` available as defensive registrations. `beamling.com` is a parked registration.
- No BEAMLING trademark found; formal clearance in classes 9 and 42 needed before filing.
- Only prior use: an informal asset name in the BeamNG.drive/BeamMP modding community.

### Voice and tone

- Warm, precise, calm; never overconfident ("The sources suggest…").
- Admit thin evidence plainly. No exclamation marks in system copy.
- Examples:
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

Typography: **Inter** (UI, body), **JetBrains Mono** (code, token counts). Logo: Inter SemiBold wordmark; mark to be defined.
