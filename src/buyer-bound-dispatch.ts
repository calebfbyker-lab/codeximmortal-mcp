import type { VerifiedPrincipal } from "./mcp-auth.js";

// Dispatcher boundary between authenticated MCP requests and delivery.
// Delivery is default-off. Identity comes only from the middleware-verified
// principal; tool arguments can never override buyer identity or supply
// credentials. Base44 remains the sole entitlement, balance, job, and result
// authority; no local settlement or retry logic exists here.

export const DELIVERY_TOOL_PREFIX = "codex_web_to_json_";

export const DELIVERY_TOOLS = {
  balance: "codex_web_to_json_balance",
  extract: "codex_web_to_json_extract",
  job: "codex_web_to_json_job",
} as const;

export type DeliveryOperation = keyof typeof DELIVERY_TOOLS;

export interface ExtractionInput {
  readonly url: string;
  readonly idempotency_key: string;
}

/**
 * Implemented by the trusted backend adapter. Credentials stay inside this
 * session and are never exposed to tool arguments or results.
 */
export interface BuyerSession {
  balance(): Promise<unknown>;
  extract(input: ExtractionInput): Promise<unknown>;
  job(id: string): Promise<unknown>;
}

export interface DispatcherDependencies {
  /** Audience the verified principal must carry. */
  readonly expectedAudience: string;

  /** Evaluated on every delivery invocation. Missing means disabled. */
  readonly deliveryEnabled?: () => boolean;

  /** Operation-specific permissions from the reviewed issuer contract. */
  readonly requiredScopes: Readonly<
    Record<DeliveryOperation, readonly string[]>
  >;

  /** Resolves a buyer-bound session from verified issuer + subject only. */
  readonly openBuyerSession?: (
    identity: Readonly<{ issuer: string; subject: string }>,
  ) => Promise<BuyerSession>;

  /** Validates and projects backend output to allowlisted public results. */
  readonly toPublicResult?: (
    operation: DeliveryOperation,
    value: unknown,
  ) => unknown;

  readonly legacyDispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

type BoundaryErrorCode =
  | "delivery_disabled"
  | "authentication_required"
  | "insufficient_permission"
  | "invalid_arguments"
  | "delivery_failed";

export class DeliveryBoundaryError extends Error {
  constructor(readonly code: BoundaryErrorCode) {
    super(code);
    this.name = "DeliveryBoundaryError";
  }
}

function deny(code: BoundaryErrorCode): never {
  throw new DeliveryBoundaryError(code);
}

function operationFor(name: string): DeliveryOperation | undefined {
  switch (name) {
    case DELIVERY_TOOLS.balance:
      return "balance";
    case DELIVERY_TOOLS.extract:
      return "extract";
    case DELIVERY_TOOLS.job:
      return "job";
    default:
      return undefined;
  }
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deny("invalid_arguments");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return deny("invalid_arguments");
  }

  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      return deny("invalid_arguments");
    }
    // Do not evaluate getters supplied by an in-process caller.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      return deny("invalid_arguments");
    }
  }

  return value as Record<string, unknown>;
}

function extractionInput(value: unknown): ExtractionInput {
  const args = exactObject(value, ["url", "idempotency_key"]);
  if (
    typeof args.url !== "string" ||
    args.url.length === 0 ||
    args.url.length > 2_000 ||
    typeof args.idempotency_key !== "string" ||
    !/^[A-Za-z0-9:._-]{1,64}$/.test(args.idempotency_key)
  ) {
    return deny("invalid_arguments");
  }

  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return deny("invalid_arguments");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443")
  ) {
    return deny("invalid_arguments");
  }

  // Preserve the original input for backend idempotency comparison.
  // Authoritative DNS/private-address and redirect checks belong to the
  // backend worker.
  return Object.freeze({
    url: args.url,
    idempotency_key: args.idempotency_key,
  });
}

function jobId(value: unknown): string {
  const args = exactObject(value, ["id"]);
  if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(args.id)) {
    return deny("invalid_arguments");
  }
  return args.id;
}

export function createBuyerBoundDispatcher(
  verifiedPrincipal: VerifiedPrincipal,
  deps: DispatcherDependencies,
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  if (!deps.expectedAudience) {
    throw new Error("Missing expected MCP audience");
  }

  // Snapshot trusted request context; never read identity from arguments.
  // This function does not itself authenticate a caller.
  const principal = Object.freeze({
    issuer: verifiedPrincipal.issuer,
    subject: verifiedPrincipal.subject,
    audience: verifiedPrincipal.audience,
    expiresAt: verifiedPrincipal.expiresAt,
    scopes: Object.freeze([...verifiedPrincipal.scopes]),
  });

  const permissions = {
    balance: Object.freeze([...deps.requiredScopes.balance]),
    extract: Object.freeze([...deps.requiredScopes.extract]),
    job: Object.freeze([...deps.requiredScopes.job]),
  } as const;

  for (const scopes of Object.values(permissions)) {
    if (
      scopes.length === 0 ||
      scopes.some((scope) => typeof scope !== "string" || !scope.trim())
    ) {
      throw new Error("Missing delivery permission configuration");
    }
  }

  function authorize(operation: DeliveryOperation): void {
    // No configuration fallback can silently enable delivery.
    if (deps.deliveryEnabled?.() !== true) {
      deny("delivery_disabled");
    }

    if (
      !principal.issuer ||
      !principal.subject ||
      principal.audience !== deps.expectedAudience ||
      !Number.isFinite(principal.expiresAt) ||
      principal.expiresAt <= Date.now() / 1_000
    ) {
      deny("authentication_required");
    }

    if (
      permissions[operation].some((scope) => !principal.scopes.includes(scope))
    ) {
      deny("insufficient_permission");
    }
  }

  return async (name, args) => {
    const operation = operationFor(name);

    if (!operation) {
      // Delivery-like names must never reach the generic gateway.
      if (name.startsWith(DELIVERY_TOOL_PREFIX)) {
        return deny("delivery_disabled");
      }
      return deps.legacyDispatch(name, args);
    }

    authorize(operation);

    // Validate and copy inputs before any asynchronous work.
    let input: ExtractionInput | undefined;
    let id: string | undefined;
    switch (operation) {
      case "balance":
        exactObject(args, []);
        break;
      case "extract":
        input = extractionInput(args);
        break;
      case "job":
        id = jobId(args);
        break;
    }

    const openSession = deps.openBuyerSession;
    const toPublic = deps.toPublicResult;
    if (!openSession || !toPublic) {
      deny("delivery_failed");
    }

    let session: BuyerSession;
    try {
      session = await openSession(
        Object.freeze({
          issuer: principal.issuer,
          subject: principal.subject,
        }),
      );
    } catch {
      return deny("delivery_failed");
    }

    // Re-authorize: the enable flag or principal may have changed during
    // credential resolution. This cannot cancel a mutation Base44 already
    // accepted; retries must reuse the same idempotency key.
    authorize(operation);

    try {
      let result: unknown;
      switch (operation) {
        case "balance":
          result = await session.balance();
          break;
        case "extract":
          result = await session.extract(input!);
          break;
        case "job":
          result = await session.job(id!);
          break;
      }
      return toPublic(operation, result);
    } catch {
      // Never retry mutations or expose upstream exception text.
      return deny("delivery_failed");
    }
  };
}

/**
 * Guard used when MCP authentication is not configured: blocks every
 * delivery tool name (including manually submitted ones) and delegates the
 * rest to the existing dispatcher. Delivery can never execute through this
 * path, and the manifest does not advertise delivery tools.
 */
export function createDeliveryGuardDispatcher(
  legacyDispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  return async (name, args) => {
    if (operationFor(name) || name.startsWith(DELIVERY_TOOL_PREFIX)) {
      return deny("delivery_disabled");
    }
    return legacyDispatch(name, args);
  };
}
