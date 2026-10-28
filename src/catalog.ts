import { findProjectFile } from "./load-tools.js";

export interface CatalogOffer {
  offer_id: string;
  product_id: string;
  title: string;
  description: string;
  category: string;
  pricing: {
    basis: string;
    amount_minor: number;
    currency: string;
    options: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

export interface Catalog {
  catalog_version: string;
  offers: CatalogOffer[];
  [key: string]: unknown;
}

export function loadCatalog(): Catalog {
  return JSON.parse(findProjectFile("catalog.json")) as Catalog;
}

export function listOffers(category?: string): { catalog_version: string; count: number; offers: CatalogOffer[] } {
  const catalog = loadCatalog();
  const offers =
    category && category !== "all" ? catalog.offers.filter((o) => o.category === category) : catalog.offers;
  return { catalog_version: catalog.catalog_version, count: offers.length, offers };
}

export function getOffer(offerId: string): CatalogOffer {
  const catalog = loadCatalog();
  const offer = catalog.offers.find((o) => o.offer_id === offerId || o.product_id === offerId);
  if (!offer) {
    throw new Error(`unknown offer: ${offerId}`);
  }
  return offer;
}
