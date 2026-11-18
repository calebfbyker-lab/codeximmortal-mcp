import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "./api.js";
import { createAgentFundingRouter, type DepositInstructions, type FundingRouterDependencies } from "./funding-router.js";

const principal: Principal = { buyerId: "00000000-0000-4000-8000-000000000001", clientId: "agent", scopes: ["funding:create"] };

function instructions(orderId: string): DepositInstructions {
  return {
    orderId, reference: `dep_${orderId}`, status: "awaiting_payment",
    network: "base-sepolia", asset: { symbol: "USDC", contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
    recipient: "0x1111111111111111111111111111111111111111", amountAtomic: "500000000",
    credit: { amountMinor: "500", currency: "USD" }, expiresAt: "2026-11-19T00:00:00.000Z",
  };
}

function makeDeps(overrides: Partial<FundingRouterDependencies> = {}): FundingRouterDependencies {
  return {
    enabled: true,
    authenticate: async () => principal,
    consume: async () => ({ allowed: true, retryAfter: 0 }),
    backend: { create: async () => ({ created: true, instructions: instructions("order-1") }) },
    ...overrides,
  };
}

async function post(deps: FundingRouterDependencies, init: RequestInit): Promise<Response> {
  const app = express();
  app.use(createAgentFundingRouter(deps));
  const server = app.listen(0, "127.0.0.1") as Server;
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fetch(`http://127.0.0.1:${port}/funding/orders`, init);
  } finally {
    server.close();
  }
}

function request(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
      "Idempotency-Key": "unit-test-key-000001",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

async function errorBody(response: Response): Promise<{ error: { code: string } }> {
  return await response.json() as { error: { code: string } };
}

describe("agent funding router", () => {
  it("is disabled by default without calling the backend", async () => {
    const create = vi.fn(async () => ({ created: true, instructions: instructions("order-1") }));
    const response = await post(makeDeps({ enabled: false, backend: { create } }), request({ packageId: "pkg" }));
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe("funding_disabled");
    expect(create).not.toHaveBeenCalled();
  });
  it("requires a bearer token", async () => {
    const response = await post(makeDeps(), request({ packageId: "pkg" }, { authorization: "" }));
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("unauthorized");
  });
  it("requires the funding:create scope", async () => {
    const response = await post(makeDeps({ authenticate: async () => ({ ...principal, scopes: [] }) }), request({ packageId: "pkg" }));
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.code).toBe("insufficient_scope");
  });
  it("returns 429 with Retry-After when rate limited", async () => {
    const response = await post(makeDeps({ consume: async () => ({ allowed: false, retryAfter: 30 }) }), request({ packageId: "pkg" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });
  it("requires a JSON body", async () => {
    const response = await post(makeDeps(), request({ packageId: "pkg" }, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });
  it("requires a well-formed idempotency key", async () => {
    for (const key of ["short", "", "invalid!key-with-symbols"]) {
      const response = await post(makeDeps(), request({ packageId: "pkg" }, { "Idempotency-Key": key }));
      expect(response.status).toBe(400);
      expect((await errorBody(response)).error.code).toBe("idempotency_key_required");
    }
  });
  it("rejects unexpected body fields", async () => {
    const response = await post(makeDeps(), request({ packageId: "pkg", buyerId: "00000000-0000-4000-8000-000000000002" }));
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("invalid_request");
  });
  it("returns 201 with instructions on creation and 200 on replay", async () => {
    const create = vi.fn(async () => ({ created: true, instructions: instructions("order-1") }));
    const first = await post(makeDeps({ backend: { create } }), request({ packageId: "pkg" }));
    expect(first.status).toBe(201);
    expect(((await first.json()) as { data: DepositInstructions }).data.orderId).toBe("order-1");
    const replay = await post(makeDeps({ backend: { create: async () => ({ created: false, instructions: instructions("order-1") }) } }), request({ packageId: "pkg" }));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { data: DepositInstructions }).data.orderId).toBe("order-1");
  });
  it("propagates backend policy errors without leaking details", async () => {
    const response = await post(makeDeps({ backend: { create: async () => { throw Object.assign(new Error("private"), { status: 404, code: "unknown_package" }); } } }), request({ packageId: "missing" }));
    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe("unknown_package");
  });
});
