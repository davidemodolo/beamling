import type { BravePlan } from "../../contracts";
import { providerSlotKey } from "../crypto";
import { reserveProviderSlot } from "../repo";
import { sleep } from "./shared";

function minIntervalMs(plan: BravePlan): number {
  if (plan === "paid") {
    const paid = Number(process.env.BRAVE_PAID_MIN_INTERVAL_MS ?? "0");
    return Number.isFinite(paid) && paid >= 0 ? paid : 0;
  }
  const raw = Number(process.env.BRAVE_MIN_INTERVAL_MS ?? "1100");
  return Number.isFinite(raw) && raw >= 0 ? raw : 1100;
}

/** Waits for this key's next database-backed slot, so spacing holds across instances. */
export async function waitForBraveSlot(apiKey: string, plan: BravePlan, signal?: AbortSignal): Promise<void> {
  const interval = minIntervalMs(plan);
  if (interval <= 0) return;
  const wait = await reserveProviderSlot(providerSlotKey("brave", apiKey), interval);
  if (wait > 0) await sleep(wait, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
