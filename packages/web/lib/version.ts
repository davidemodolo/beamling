/** Build identity, injected by next.config.ts from APP_VERSION, GIT_COMMIT and BUILD_TIME. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0-dev";
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || "local";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";
export const SHORT_COMMIT = GIT_COMMIT === "local" ? "local" : GIT_COMMIT.slice(0, 7);

export function versionLabel(): string {
  return `v${APP_VERSION} · ${SHORT_COMMIT}`;
}
