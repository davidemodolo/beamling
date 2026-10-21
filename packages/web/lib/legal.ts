export interface LegalDetails {
  entity: string;
  address: string | undefined;
  contactEmail: string;
  governingLaw: string;
}

/** Public operator details. Production requires entity and contact email at boot. */
export function legalDetails(): LegalDetails {
  return {
    entity: process.env.LEGAL_ENTITY?.trim() || "the Beamling operator",
    address: process.env.LEGAL_ADDRESS?.trim() || undefined,
    contactEmail: process.env.LEGAL_CONTACT_EMAIL?.trim() || "Contact details are not configured for this deployment.",
    governingLaw: process.env.LEGAL_GOVERNING_LAW?.trim() || "Italian law",
  };
}

export const LEGAL_LAST_UPDATED = "21 October 2026";
