import type { Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

// OAuth 2.x resource-server middleware for the /mcp endpoint.
// The server validates that each access token was issued FOR this MCP
// server (audience), by an approved issuer, with an approved algorithm.
// MCP bearer tokens are never forwarded to Base44 or any other backend.

type GetKey = Parameters<typeof jwtVerify>[1];

const APPROVED_ALGORITHMS = new Set(["RS256", "PS256", "ES256", "EdDSA"]);
const SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const MAX_AUTHORIZATION_LENGTH = 8_192;

export interface VerifiedPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}

export interface McpAuthConfig {
  readonly issuer: string;
  readonly resource: string;
  readonly jwksUrl: string;
  readonly algorithm: string;
  readonly baselineScopes: readonly string[];
}

export interface McpAuth {
  readonly resource: string;
  readonly requireBuyer: RequestHandler;
  readonly metadata: RequestHandler;
  readonly principalFor: (req: Request) => VerifiedPrincipal;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required MCP auth configuration: ${name}`);
  }
  return value;
}

function httpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid MCP auth configuration: ${name}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error(`Invalid HTTPS MCP auth configuration: ${name}`);
  }
  return url;
}

function scopeList(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))];
}

export function validateMcpAuthConfig(config: McpAuthConfig): McpAuthConfig {
  httpsUrl(config.issuer, "issuer");
  httpsUrl(config.resource, "resource");
  httpsUrl(config.jwksUrl, "jwksUrl");
  if (!APPROVED_ALGORITHMS.has(config.algorithm)) {
    throw new Error("Unsupported MCP_AUTH_ALGORITHM");
  }
  const baseline = [...config.baselineScopes];
  if (baseline.some((scope) => !SCOPE_PATTERN.test(scope))) {
    throw new Error("Invalid MCP baseline scopes");
  }
  return Object.freeze({
    issuer: config.issuer,
    resource: config.resource,
    jwksUrl: config.jwksUrl,
    algorithm: config.algorithm,
    baselineScopes: Object.freeze(baseline),
  });
}

export function loadMcpAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): McpAuthConfig {
  return validateMcpAuthConfig({
    issuer: required(env, "MCP_AUTH_ISSUER"),
    resource: required(env, "MCP_AUTH_RESOURCE"),
    jwksUrl: required(env, "MCP_AUTH_JWKS_URL"),
    algorithm: required(env, "MCP_AUTH_ALGORITHM"),
    baselineScopes: scopeList(env.MCP_AUTH_BASELINE_SCOPES ?? ""),
  });
}

/**
 * Returns undefined only when no MCP_AUTH_* variables are configured, which
 * preserves current anonymous /mcp behavior. Partial configuration throws
 * at startup so a half-configured deployment cannot serve unprotected MCP.
 */
export function loadOptionalMcpAuth(
  env: NodeJS.ProcessEnv = process.env,
): McpAuth | undefined {
  const configured = [
    "MCP_AUTH_ISSUER",
    "MCP_AUTH_RESOURCE",
    "MCP_AUTH_JWKS_URL",
    "MCP_AUTH_ALGORITHM",
  ].some((name) => Boolean(env[name]?.trim()));
  return configured ? createMcpAuth(loadMcpAuthConfig(env)) : undefined;
}

export function createMcpAuth(
  input: McpAuthConfig,
  options: { getKey?: GetKey } = {},
): McpAuth {
  // Validate at the construction boundary; no caller can bypass checks.
  const config = validateMcpAuthConfig(input);

  // Fixed administrative configuration only. JWT jku/x5u headers and request
  // arguments are never used as key sources.
  const getKey: GetKey =
    options.getKey ??
    createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });

  const metadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    httpsUrl(config.resource, "resource").origin,
  ).href;

  // A principal can enter this map only after successful verification.
  // No bearer token is retained in the principal.
  const principals = new WeakMap<Request, VerifiedPrincipal>();

  const quoted = (value: string): string => {
    if (/[\r\n]/.test(value)) {
      throw new Error("Invalid authentication challenge value");
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  };

  const challenge = (error?: string): string =>
    "Bearer " +
    [
      `resource_metadata=${quoted(metadataUrl)}`,
      ...(config.baselineScopes.length
        ? [`scope=${quoted(config.baselineScopes.join(" "))}`]
        : []),
      ...(error ? [`error=${quoted(error)}`] : []),
    ].join(", ");

  const respond = (
    res: Response,
    status: 401 | 403 | 503,
    errorBody: string,
    challengeError?: string,
  ): void => {
    res.setHeader("WWW-Authenticate", challenge(challengeError));
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({ error: errorBody });
  };

  const requireBuyer: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");

    // Reject multiple Authorization header instances.
    let authorizationHeaders = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === "authorization") {
        authorizationHeaders += 1;
      }
    }

    const header = req.headers.authorization;
    const match =
      header && header.length <= MAX_AUTHORIZATION_LENGTH
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
            header,
          )
        : null;

    if (authorizationHeaders !== 1 || !header || !match) {
      respond(
        res,
        401,
        header ? "invalid_token" : "authentication_required",
        header ? "invalid_token" : undefined,
      );
      return;
    }

    void (async () => {
      try {
        const { payload } = await jwtVerify(match[1], getKey, {
          algorithms: [config.algorithm],
          issuer: config.issuer,
          audience: config.resource,
          typ: "at+jwt",
          requiredClaims: ["iss", "aud", "sub", "exp"],
        });

        if (
          typeof payload.sub !== "string" ||
          payload.sub.trim().length === 0 ||
          typeof payload.exp !== "number" ||
          !Number.isFinite(payload.exp)
        ) {
          respond(res, 401, "invalid_token", "invalid_token");
          return;
        }

        const scopes =
          typeof payload.scope === "string"
            ? [...new Set(payload.scope.split(/\s+/).filter(Boolean))]
            : [];

        // Baseline access policy only. Operation-specific delivery
        // permissions are enforced inside the dispatcher boundary.
        if (config.baselineScopes.some((scope) => !scopes.includes(scope))) {
          respond(res, 403, "insufficient_scope", "insufficient_scope");
          return;
        }

        principals.set(
          req,
          Object.freeze({
            issuer: config.issuer,
            subject: payload.sub,
            audience: config.resource,
            expiresAt: payload.exp,
            scopes: Object.freeze(scopes),
          }),
        );
        next();
      } catch (error) {
        // Distinguish verification-infrastructure failure from a bad token.
        // Never expose tokens, key URLs, or verifier exception text.
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code.startsWith("ERR_JWKS")) {
          respond(res, 503, "authorization_unavailable", "temporarily_unavailable");
          return;
        }
        respond(res, 401, "invalid_token", "invalid_token");
      }
    })().catch(next);
  };

  const metadata: RequestHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: [...config.baselineScopes],
      bearer_methods_supported: ["header"],
    });
  };

  const principalFor = (req: Request): VerifiedPrincipal => {
    const principal = principals.get(req);
    if (!principal) {
      throw new Error("Verified MCP principal context required");
    }
    return principal;
  };

  return Object.freeze({
    resource: config.resource,
    requireBuyer,
    metadata,
    principalFor,
  });
}
