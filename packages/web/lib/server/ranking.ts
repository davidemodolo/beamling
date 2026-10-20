import type { Source } from "../types";

/** Query-string parameters that only track the click and never change the page. */
const TRACKING_PARAM = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi)$/i;

// Second-level labels under which registrations happen one level deeper (example.co.uk).
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "nic"]);

/** Canonical form for deduplication: lower-case host, no www, fragment, tracking params or trailing slash. */
export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let text = url.toString();
    if (url.pathname.length > 1 && url.pathname.endsWith("/") && !url.search) text = text.replace(/\/$/, "");
    return text;
  } catch {
    return value;
  }
}

/** Approximate registrable domain, so en.example.org and de.example.org count as one site. */
export function siteOf(domain: string): string {
  const labels = domain.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const take = SECOND_LEVEL.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

type Candidate = Omit<Source, "position">;

/**
 * Picks up to `limit` sources from per-query result lists. Results are taken round-robin by provider
 * rank, so every query contributes its best results first, exact duplicates are dropped by canonical
 * URL, and each site is capped at `perSite` until no other site has results left.
 */
export function rankSources(
  batches: Candidate[][],
  options: { limit: number; perSite: number; exclude?: Source[]; startPosition?: number },
): Source[] {
  const seen = new Set((options.exclude ?? []).map((source) => canonicalUrl(source.url)));
  const perSite = new Map<string, number>();
  for (const source of options.exclude ?? []) {
    const site = siteOf(source.domain);
    perSite.set(site, (perSite.get(site) ?? 0) + 1);
  }

  const ordered: Candidate[] = [];
  const depth = Math.max(0, ...batches.map((batch) => batch.length));
  for (let rank = 0; rank < depth; rank++) {
    for (const batch of batches) {
      const candidate = batch[rank];
      if (!candidate) continue;
      const key = canonicalUrl(candidate.url);
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(candidate);
    }
  }

  const picked: Candidate[] = [];
  const overflow: Candidate[] = [];
  for (const candidate of ordered) {
    if (picked.length >= options.limit) break;
    const site = siteOf(candidate.domain);
    const used = perSite.get(site) ?? 0;
    if (used >= options.perSite) {
      overflow.push(candidate);
      continue;
    }
    perSite.set(site, used + 1);
    picked.push(candidate);
  }
  // Diversity is a preference, not a filter: fill remaining room with the capped results in rank order.
  for (const candidate of overflow) {
    if (picked.length >= options.limit) break;
    picked.push(candidate);
  }

  const start = options.startPosition ?? 1;
  return picked.map((candidate, index) => ({ ...candidate, position: start + index }));
}
