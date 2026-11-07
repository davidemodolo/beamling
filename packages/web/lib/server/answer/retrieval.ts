import { rankSources } from "../ranking";
import {
  DEEP_RESULTS_PER_QUERY,
  DEEP_SOURCE_LIMIT,
  everySearchFailed,
  isSearchOutage,
  runSearches,
  SEARCH_CONCURRENCY,
  type RunContext,
  type RunState,
} from "./context";

const RECENCY_PATTERNS: [RegExp, number][] = [
  [/(?<!\p{L})(today|tonight|oggi|stasera|hoy|aujourd'hui|heute)(?!\p{L})/iu, 1],
  [/(?<!\p{L})(this week|questa settimana|esta semana|cette semaine|diese woche)(?!\p{L})/iu, 7],
  [
    /(?<!\p{L})(latest|recent|recently|news|breaking|this month|currently|ultim[aeio]|recent[ei]|notizie|attualmente|últim[oa]s?|noticias|derni[eè]res?|actualités|neueste[nrs]?|aktuell[e]?|nachrichten)(?!\p{L})/iu,
    30,
  ],
];

/** Search freshness in days, set only when the question asks for recent information. */
export function freshnessDays(question: string): number | undefined {
  return RECENCY_PATTERNS.find(([pattern]) => pattern.test(question))?.[1];
}

/** How many results each query asks for and how many ranked sources are kept. */
export interface RetrievalLimits {
  resultsPerQuery: number;
  sources: number;
  /** Most sources kept from one site. */
  perSite: number;
  /** Report "Searching n of m" (true) or a plain "Searching the web". */
  detailed: boolean;
}

export const DEEP_RETRIEVAL: RetrievalLimits = {
  resultsPerQuery: DEEP_RESULTS_PER_QUERY,
  sources: DEEP_SOURCE_LIMIT,
  perSite: 3,
  detailed: true,
};

/**
 * Searches every planned query, two at a time, and ranks the results into the answer's sources.
 * Used by Deep and by fixture runs of the research loop. Fails only if every search failed.
 */
export async function retrieveSources(
  ctx: RunContext,
  state: RunState,
  queries: string[],
  limits: RetrievalLimits,
): Promise<void> {
  const progress = (completed: number) =>
    limits.detailed ? `Searching ${completed} of ${queries.length}` : "Searching the web";
  ctx.emit("stage", { stage: "searching", detail: progress(0) });

  const { batches, errors } = await runSearches(ctx, state, queries, {
    count: limits.resultsPerQuery,
    concurrency: SEARCH_CONCURRENCY,
    onSettled: (completed) => {
      ctx.emit("progress", { completed, total: queries.length });
      ctx.emit("stage", { stage: "searching", detail: progress(completed) });
    },
  });

  if (state.searchRequests === 0 && errors.length) {
    if (!isSearchOutage(errors[0])) throw errors[0];
    throw everySearchFailed(ctx.prepared.searchProvider);
  }
  state.sources = rankSources(batches.filter(Boolean), { limit: limits.sources, perSite: limits.perSite, startPosition: 1 });
}
