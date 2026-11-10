import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createMcpAuth, type McpAuth, type McpAuthConfig } from "./mcp-auth.js";

const ISSUER = "https://auth.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const JWKS_URL = "https://auth.example.test/jwks";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const { privateKey: wrongAlgPrivateKey } = await generateKeyPair("ES256");
const getKey = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });

function config(overrides: Partial<McpAuthConfig> = {}): McpAuthConfig {
  return {
    issuer: ISSUER,
    resource: RESOURCE,
    jwksUrl: JWKS_URL,
    algorithm: "RS256",
    baselineScopes: [],
    ...overrides,
  };
}

interface TokenOptions {
  subject?: string;
  scope?: string;
  typ?: string;
  issuer?: string;
  audience?: string;
  expired?: boolean;
  signWith?: CryptoKey;
  alg?: string;
}

async function token(options: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT(
    options.scope === undefined ? {} : { scope: options.scope },
  )
    .setProtectedHeader({
      alg: options.alg ?? "RS256",
      typ: options.typ ?? "at+jwt",
    })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? RESOURCE)
    .setSubject(options.subject ?? "buyer-a")
    .setIssuedAt()
    .setExpirationTime(options.expired ? "-1h" : "15m");
  return jwt.sign(options.signWith ?? privateKey);
}

function mockRes(): Response {
  const status = vi.fn();
  const res = {
    setHeader: vi.fn(),
    status,
    json: vi.fn(),
  };
  status.mockImplementation(() => res);
  return res as unknown as Response;
}

function mockReq(headers: Record<string, string>): Request {
  const rawHeaders: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    rawHeaders.push(name, value);
  }
  return { headers, rawHeaders } as unknown as Request;
}

async function runMiddleware(
  auth: McpAuth,
  req: Request,
): Promise<{ res: Response; next: ReturnType<typeof vi.fn> }> {
  const res = mockRes();
  const next = vi.fn();
  auth.requireBuyer(req, res, next);
  await vi.waitFor(() => {
    if (next.mock.calls.length === 0 && res.status.mock.calls.length === 0) {
      throw new Error("middleware did not settle");
    }
  });
  return { res, next };
}

function bearer(value: string): string {
  return `Bearer ${value}`;
}

describe("createMcpAuth configuration", () => {
  it("rejects an unapproved algorithm", () => {
    expect(() => createMcpAuth(config({ algorithm: "HS256" }), { getKey })).toThrow();
  });

  it("rejects a non-HTTPS issuer", () => {
    expect(() =>
      createMcpAuth(config({ issuer: "http://auth.example.test" }), { getKey }),
    ).toThrow();
  });
});

describe("createMcpAuth requireBuyer", () => {
  const auth = createMcpAuth(config(), { getKey });

  it("rejects a missing authorization header with 401", async () => {
    const { res, next } = await runMiddleware(auth, mockReq({}));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "authentication_required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects duplicate authorization headers", async () => {
    const value = bearer(await token());
    const req = {
      headers: { authorization: value },
      rawHeaders: ["Authorization", value, "authorization", value],
    } as unknown as Request;
    const { res, next } = await runMiddleware(auth, req);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed bearer token", async () => {
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: "Bearer not-a-jwt" }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
  });

  it("rejects an oversized authorization header", async () => {
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: `Bearer ${"a".repeat(9000)}` }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token signed with an unapproved algorithm", async () => {
    const value = await token({ signWith: wrongAlgPrivateKey, alg: "ES256" });
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
  });

  it("rejects a wrong issuer", async () => {
    const value = await token({ issuer: "https://evil.example.test" });
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a wrong audience", async () => {
    const value = await token({ audience: "https://other.example.test/mcp" });
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an expired token", async () => {
    const value = await token({ expired: true });
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a non-access-token JWT typ", async () => {
    const value = await token({ typ: "JWT" });
    const { res } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts a valid token and stores a request-local principal", async () => {
    const value = await token({ scope: "catalog:read" });
    const req = mockReq({ authorization: bearer(value) });
    const { next } = await runMiddleware(auth, req);
    expect(next).toHaveBeenCalledTimes(1);
    const principal = auth.principalFor(req);
    expect(principal.issuer).toBe(ISSUER);
    expect(principal.subject).toBe("buyer-a");
    expect(principal.audience).toBe(RESOURCE);
    expect(principal.scopes).toContain("catalog:read");
  });

  it("keeps concurrent principals isolated per request", async () => {
    const reqA = mockReq({ authorization: bearer(await token({ subject: "buyer-a" })) });
    const reqB = mockReq({ authorization: bearer(await token({ subject: "buyer-b" })) });
    await runMiddleware(auth, reqA);
    await runMiddleware(auth, reqB);
    expect(auth.principalFor(reqA).subject).toBe("buyer-a");
    expect(auth.principalFor(reqB).subject).toBe("buyer-b");
  });

  it("throws when principalFor is called on an unauthenticated request", () => {
    expect(() => auth.principalFor(mockReq({}))).toThrow();
  });
});

describe("createMcpAuth baseline scopes", () => {
  const scopedAuth = createMcpAuth(config({ baselineScopes: ["catalog:read"] }), {
    getKey,
  });

  it("rejects a valid token missing a baseline scope with 403", async () => {
    const value = await token({ scope: "unrelated:scope" });
    const { res, next } = await runMiddleware(
      scopedAuth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "insufficient_scope" });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a token carrying the baseline scope", async () => {
    const value = await token({ scope: "catalog:read" });
    const { next } = await runMiddleware(
      scopedAuth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpAuth metadata", () => {
  it("serves protected-resource metadata", () => {
    const auth = createMcpAuth(config(), { getKey });
    const res = mockRes();
    auth.metadata(mockReq({}), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: [],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("verification infrastructure failures", () => {
  it("returns 503 when the JWKS source is unavailable", async () => {
    const failingKey = (() => {
      throw Object.assign(new Error("jwks unavailable"), {
        code: "ERR_JWKS_TIMEOUT",
      });
    }) as unknown as Parameters<typeof createMcpAuth>[1] extends undefined
      ? never
      : NonNullable<Parameters<typeof createMcpAuth>[1]>["getKey"];
    const auth = createMcpAuth(config(), { getKey: failingKey });
    const value = await token();
    const { res, next } = await runMiddleware(
      auth,
      mockReq({ authorization: bearer(value) }),
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "authorization_unavailable" });
    expect(next).not.toHaveBeenCalled();
  });
});
