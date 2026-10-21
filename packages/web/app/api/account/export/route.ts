import { audit } from "@/lib/server/audit";
import { json, notFound } from "@/lib/server/http";
import { consumeRateLimit, exportAccount } from "@/lib/server/repo";
import { apiRoute } from "@/lib/server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every stored record of the account as a JSON download. Allowed before the terms are accepted. */
export const GET = apiRoute(
  async ({ request, user }) => {
    await consumeRateLimit(`exports:${user.id}`, 5, 3600);
    const data = await exportAccount(user.id);
    if (!data) throw notFound("Account not found.");
    audit("data_exported", { userId: user.id, headers: request.headers });
    const day = data.exportedAt.slice(0, 10);
    return json(data, { headers: { "Content-Disposition": `attachment; filename="beamling-export-${day}.json"` } });
  },
  { requireTerms: false },
);
