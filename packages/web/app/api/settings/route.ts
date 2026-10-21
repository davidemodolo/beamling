import { z } from "zod";
import { isAllowedModel, SEARCH_PROVIDER_IDS } from "@/lib/providers";
import { analytics } from "@/lib/server/analytics";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { ensureSettings, updateSettings } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  llmModel: z.string().max(200).optional(),
  defaultSearchProvider: z.enum(SEARCH_PROVIDER_IDS).optional(),
  defaultMode: z.enum(["quick", "deep", "deeper"]).optional(),
});

export const PATCH = apiRoute(async ({ request, user }) => {
  const patch = await parseBody(request, schema);
  if (patch.llmModel && !isAllowedModel(patch.llmModel)) {
    throw new ApiError("MODEL_NOT_ALLOWED", "That model is not in the Alpha 1 allowlist.", 400);
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
