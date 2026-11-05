import "server-only";

import { isAccsZoneConfigured } from "@/lib/providers/accszone";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import { isBulkaccConfigured } from "@/lib/providers/bulkacc";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { isFoxreloadConfigured } from "@/lib/providers/foxreload";
import { isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { isTempMailConfigured } from "@/lib/providers/tempmail";
import { PROVIDER_IDS, type ProviderDescriptor, type ProviderId } from "@/lib/providers/types";

/**
 * Every supplier, in one table.
 *
 * An operator page that wants to know "what is connected?" used to import six
 * modules and remember six function names. Now it enumerates this, and adding a
 * supplier means adding one row — the same reason the service registry exists one
 * layer up.
 *
 * `supplies` is the link back to the product vocabulary: it names the order tags
 * a supplier can deliver, so a lane and its credential can be compared without a
 * lookup table nobody maintains. A supplier that sells a free tool supplies no
 * order tag, which is why the inbox row has an empty list.
 */
export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  fleexa: {
    id: "fleexa",
    label: "Number & inbox gateway",
    configured: isFleexaConfigured,
    supplies: ["numbers", "email-otp"],
  },
  bitcall: {
    id: "bitcall",
    label: "Number & eSIM gateway",
    configured: isBitcallConfigured,
    supplies: ["numbers", "esim"],
  },
  foxreload: {
    id: "foxreload",
    label: "Digital voucher supplier",
    configured: isFoxreloadConfigured,
    supplies: ["gift-cards"],
  },
  accszone: {
    id: "accszone",
    label: "Account marketplace feed",
    configured: isAccsZoneConfigured,
    supplies: ["accounts"],
  },
  bulkacc: {
    id: "bulkacc",
    label: "Account bulk feed",
    configured: isBulkaccConfigured,
    supplies: ["accounts"],
  },
  smm: {
    id: "smm",
    label: "Social boosting panel",
    configured: isSmmPanelConfigured,
    supplies: ["social"],
  },
  tempmail: {
    id: "tempmail",
    label: "Temporary inbox supplier",
    configured: isTempMailConfigured,
    supplies: [],
  },
};

export const ALL_PROVIDERS: readonly ProviderDescriptor[] = PROVIDER_IDS.map((id) => PROVIDERS[id]);

/** Which suppliers claim to deliver an order tag. Used by diagnostics, not checkout. */
export function providersFor(tag: string): ProviderDescriptor[] {
  return ALL_PROVIDERS.filter((provider) => provider.supplies.includes(tag));
}

/** Configured suppliers, in table order. Never names a supplier to a customer. */
export function configuredProviders(): ProviderDescriptor[] {
  return ALL_PROVIDERS.filter((provider) => provider.configured());
}
