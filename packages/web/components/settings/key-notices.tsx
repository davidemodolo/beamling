"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { errorMessage } from "@/lib/api";
import { useAccount } from "@/lib/store";
import type { Credential } from "@/lib/types";
import { CredentialRow } from "./credential-row";

export function KeysNotice() {
  return (
    <div className="notice">
      <Icon name="shield" size={16} />
      <div>Keys are encrypted at rest and never returned to the browser.</div>
    </div>
  );
}

/** Keys for providers removed from the catalog: they can only be deleted. */
export function RetiredKeys({ credentials, onToast }: { credentials: Credential[]; onToast: (message: string) => void }) {
  const { removeCredential } = useAccount();
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!credentials.length) return null;

  const remove = async (credential: Credential) => {
    setDeleting(credential.id);
    try {
      await removeCredential(credential.id);
      onToast("Key deleted");
    } catch (cause) {
      onToast(errorMessage(cause, "Could not delete the key"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <div style={{ flex: 1 }}>
          <h2>Unsupported providers</h2>
          <p>Beamling no longer supports these. Delete the keys.</p>
        </div>
      </div>
      <div className="settings-card-body tight">
        {credentials.map((credential) => (
          <CredentialRow
            key={credential.id}
            credential={credential}
            label={credential.provider}
            busy={false}
            deleting={deleting === credential.id}
            onDelete={() => void remove(credential)}
          />
        ))}
      </div>
    </section>
  );
}
