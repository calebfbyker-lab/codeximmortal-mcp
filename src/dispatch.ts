import { listOffers, getOffer } from "./catalog.js";
import { callGatewayTool } from "./gateway.js";

// Catalog tools resolve locally from catalog.json (Stripe-sourced offers).
// All other tools route to the CI-059 gateway and fail closed until the
// gateway endpoint is configured via CODEX_GATEWAY_URL.
export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "codex_catalog_list": {
      const category = typeof args.category === "string" ? args.category : "all";
      return listOffers(category);
    }
    case "codex_catalog_get_product": {
      const offerId = typeof args.offer_id === "string" ? args.offer_id : "";
      if (!offerId) {
        throw new Error("offer_id is required");
      }
      return getOffer(offerId);
    }
    default:
      return callGatewayTool(name, args);
  }
}
