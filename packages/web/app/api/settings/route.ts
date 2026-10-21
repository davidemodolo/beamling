import { z } from "zod";
import { MODES, SEARCH_PROVIDER_IDS } from "@/lib/contracts";
import { isAllowedModel } from "@/lib/provider-catalog";
import { analytics } from "@/lib/server/analytics";
import { eraseAnalyticsNow } from "@/lib/server/analytics-erasure";
import { audit } from "@/lib/server/audit";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { ensureSettings, setAnalyticsOptOut, updateSettings } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  llmModel: z.string().max(200).optional(),
  defaultSearchProvider: z.enum(SEARCH_PROVIDER_IDS).optional(),
  defaultMode: z.enum(MODES).optional(),
  analyticsOptOut: z.boolean().optional(),
});

export const PATCH = apiRoute(async ({ request, user }) => {
  const { analyticsOptOut, ...patch } = await parseBody(request, schema);
  // Validate everything before writing anything, so a rejected request changes nothing.
  if (patch.llmModel && !isAllowedModel(patch.llmModel)) {
    throw new ApiError("MODEL_NOT_ALLOWED", "That model is not in the Alpha 1 allowlist.", 400);
  }
  if (analyticsOptOut !== undefined) {
    const distinctId = analytics.distinctIdFor(user.id);
    await setAnalyticsOptOut(user.id, analyticsOptOut, distinctId);
    audit(analyticsOptOut ? "analytics_opt_out" : "analytics_opt_in", { userId: user.id, headers: request.headers });
    if (analyticsOptOut && distinctId) await eraseAnalyticsNow(distinctId);
  }
  const previous = patch.defaultSearchProvider ? await ensureSettings(user.id) : null;
  const settings = await updateSettings(user.id, patch);
  if (previous && previous.defaultSearchProvider !== settings.defaultSearchProvider) {
    analytics.capture(user.id, "search_provider_selected", {
      search_provider: settings.defaultSearchProvider,
      previous_provider: previous.defaultSearchProvider,
    });
  }
  return json({ settings });
});
