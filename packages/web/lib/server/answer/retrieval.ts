import { rankSources } from "../ranking";
import {
  DEEP_RESULTS_PER_QUERY,
  DEEP_SOURCE_LIMIT,
  DEEPER_SOURCE_LIMIT,
  everySearchFailed,
  isSearchOutage,
  QUICK_SOURCE_LIMIT,
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

/** Brave freshness is applied only when the question asks for recent information. */
export function freshnessDays(question: string): number | undefined {
  return RECENCY_PATTERNS.find(([pattern]) => pattern.test(question))?.[1];
}

/**
 * Quick and Deep retrieval (and Deeper with fixture providers): searches every query, two at a
 * time, and ranks the results into the answer's sources. Fails only if every search failed.
 */
export async function retrieveSources(ctx: RunContext, state: RunState, queries: string[]): Promise<void> {
  const report = ctx.prepared.mode !== "quick";
  const progress = (completed: number) =>
    report ? `Searching ${completed} of ${queries.length}` : "Searching the web";
  ctx.emit("stage", { stage: "searching", detail: progress(0) });

  const { batches, errors } = await runSearches(ctx, state, queries, {
    count: report ? DEEP_RESULTS_PER_QUERY : QUICK_SOURCE_LIMIT,
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
  state.sources = rankSources(batches.filter(Boolean), {
    limit: ctx.prepared.mode === "deeper" ? DEEPER_SOURCE_LIMIT : report ? DEEP_SOURCE_LIMIT : QUICK_SOURCE_LIMIT,
    perSite: report ? 3 : 2,
    startPosition: 1,
  });
}
