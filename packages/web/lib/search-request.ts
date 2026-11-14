import { MODES, type Mode } from "./contracts";
import { MAX_QUESTION_CHARS } from "./legal";

/**
 * A question handed to Beamling by the browser's address bar: `/search#q=…&mode=…`. It travels in
 * the URL fragment, which browsers never send to a server, so the question appears in no request
 * log. The page reads it on the device and sends it as any other question.
 */
export interface SearchRequest {
  question: string;
  mode?: Mode;
}

const STASH = "beamling-search";

/** The address a browser's custom search engine should use; `%s` is the browser's placeholder. */
export const searchTemplate = (origin: string, placeholder = "%s"): string => `${origin}/search#q=${placeholder}`;

export function parseSearchFragment(fragment: string): SearchRequest | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const question = (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) return null;
  const mode = MODES.find((value) => value === params.get("mode"));
  return { question, mode };
}

/** Signed out: keeps the question in this tab while the visitor signs in. */
export function stashSearchRequest(): void {
  try {
    if (parseSearchFragment(window.location.hash)) sessionStorage.setItem(STASH, window.location.hash);
  } catch {}
}

/**
 * The pending question, read once: from the fragment (`fresh`, it came with this navigation) or
 * from the tab's stash after signing in. Both are cleared.
 */
export function takeSearchRequest(): (SearchRequest & { fresh: boolean }) | null {
  let stashed: string | null = null;
  try {
    stashed = sessionStorage.getItem(STASH);
    sessionStorage.removeItem(STASH);
  } catch {}
  const fromFragment = parseSearchFragment(window.location.hash);
  if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  if (fromFragment) return { ...fromFragment, fresh: true };
  const fromStash = stashed ? parseSearchFragment(stashed) : null;
  return fromStash ? { ...fromStash, fresh: false } : null;
}

/**
 * Whether a question from the address bar may be sent without a click: only when the navigation was
 * typed, picked from the browser itself or came from Beamling. A link on another site only fills the
 * composer, so nobody can spend the user's keys with a link.
 */
export const mayAutoSend = (secFetchSite: string | null): boolean => secFetchSite === "none" || secFetchSite === "same-origin";
