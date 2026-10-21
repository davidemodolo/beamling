// The shutdown hook and route handlers are separate Next.js bundles, so the flag lives on globalThis.
const globalForShutdown = globalThis as unknown as { __beamlingShuttingDown?: boolean };

export function beginShutdown(): void {
  globalForShutdown.__beamlingShuttingDown = true;
}

export function isShuttingDown(): boolean {
  return globalForShutdown.__beamlingShuttingDown === true;
}
