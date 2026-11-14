import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { getReadiness, type Readiness } from "@/lib/server/readiness";
import { getPublicShutdown } from "@/lib/server/repo";
import { isClosed, shutdownDateLabel } from "@/lib/server/shutdown";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

function tone(value: "up" | "down"): string {
  return value === "up" ? "Operational" : "Incident";
}

function rows(readiness: Readiness) {
  return [
    ["Application", "up" as const],
    ["Database", readiness.database],
    ["Schema", readiness.schema],
    ["Encryption / KMS", readiness.kms],
  ] as const;
}

export default async function StatusPage() {
  const readiness = await getReadiness();
  const shutdown = await getPublicShutdown().catch(() => null);
  return (
    <LegalPage
      title="Status"
      intro="Live readiness of this deployment. An incident here may also affect the page itself."
    >
      {shutdown ? (
        <p>
          <strong>
            {isClosed(shutdown)
              ? "Beamling has shut down; every account has been deleted."
              : `Scheduled shutdown: ${shutdownDateLabel(shutdown.scheduledAt)}. Every account and its data will then be deleted. Download your data from Settings → Account before then.`}
          </strong>
        </p>
      ) : null}
      <p>
        Overall: <strong>{readiness.ok ? "Operational" : "Incident"}</strong>
      </p>
      <div className="legal-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows(readiness).map(([name, state]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{tone(state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        For user-visible failures, include the time and the error code from the answer card. Report a vulnerability privately
        through the <Link href="/contact">contact page</Link>. The machine-readable probe is{" "}
        <code>/api/health</code>.
      </p>
    </LegalPage>
  );
}
