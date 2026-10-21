import { z } from "zod";
import { LEGAL_VERSION } from "@/lib/legal";
import { audit } from "@/lib/server/audit";
import { ApiError, json, parseBody } from "@/lib/server/http";
import { acceptTerms } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  version: z.string().max(40),
  confirmAge: z.literal(true, { message: "Confirm that you meet the minimum age." }),
});

/** Records acceptance of the current terms and privacy notice. A stale version is refused. */
export const POST = apiRoute(
  async ({ request, user }) => {
    const input = await parseBody(request, schema);
    if (input.version !== LEGAL_VERSION) {
      throw new ApiError("TERMS_OUTDATED", "The terms changed while this page was open. Reload and review them.", 409);
    }
    await acceptTerms(user.id, LEGAL_VERSION);
    audit("terms_accepted", { userId: user.id, headers: request.headers, fields: { version: LEGAL_VERSION } });
    return json({ ok: true, version: LEGAL_VERSION });
  },
  { requireTerms: false },
);
