export const proposedServices = Object.freeze([
  Object.freeze({ tool: "codex_pricing_snapshot", status: "planned", certification: "UNCERTIFIED", price: null, registered: false }),
  Object.freeze({ tool: "codex_pricing_compare", status: "planned", certification: "UNCERTIFIED", price: null, registered: false }),
  Object.freeze({ tool: "codex_document_extract", status: "planned", certification: "UNCERTIFIED", price: null, registered: false })
] as const);
export function assertPublicationAllowed(): never { throw new Error("service_publication_disabled"); }
