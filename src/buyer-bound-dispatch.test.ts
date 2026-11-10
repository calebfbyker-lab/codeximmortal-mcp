import { describe, expect, it, vi } from "vitest";
import {
  createBuyerBoundDispatcher,
  createDeliveryGuardDispatcher,
  DELIVERY_TOOLS,
  type BuyerSession,
  type DispatcherDependencies,
  type VerifiedPrincipal,
} from "./buyer-bound-dispatch.js";

const AUDIENCE = "https://mcp.example.test/mcp";

function principal(overrides: Partial<VerifiedPrincipal> = {}): VerifiedPrincipal {
  return {
    issuer: "https://auth.example.test",
    subject: "buyer-a",
    audience: AUDIENCE,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    scopes: ["web-to-json:read", "web-to-json:use"],
    ...overrides,
  };
}

function mockSession(): BuyerSession {
  return {
    balance: vi.fn().mockResolvedValue({ credits: 50 }),
    extract: vi.fn().mockResolvedValue({ job_id: "job_1" }),
    job: vi.fn().mockResolvedValue({ id: "job_1", status: "done" }),
  };
}

interface Harness {
  dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  opener: ReturnType<typeof vi.fn>;
  session: BuyerSession;
}

function harness(
  deps: Partial<DispatcherDependencies> = {},
  who: VerifiedPrincipal = principal(),
): Harness {
  const session = mockSession();
  const opener = vi.fn().mockResolvedValue(session);
  const dispatch = createBuyerBoundDispatcher(who, {
    expectedAudience: AUDIENCE,
    deliveryEnabled: () => true,
    requiredScopes: {
      balance: ["web-to-json:read"],
      extract: ["web-to-json:use"],
      job: ["web-to-json:read"],
    },
    openBuyerSession: opener,
    toPublicResult: (_operation, value) => value,
    legacyDispatch: vi.fn().mockResolvedValue("legacy"),
    ...deps,
  });
  return { dispatch, opener, session };
}

const VALID_EXTRACTION = {
  url: "https://example.test/pricing",
  idempotency_key: "key-001",
};

describe("delivery disabled by default", () => {
  it("denies balance when no deliveryEnabled flag is provided", async () => {
    const { dispatch, opener } = harness({ deliveryEnabled: undefined });
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "delivery_disabled",
    });
    expect(opener).not.toHaveBeenCalled();
  });

  it("denies when the flag returns false", async () => {
    const { dispatch, opener } = harness({ deliveryEnabled: () => false });
    await expect(dispatch(DELIVERY_TOOLS.extract, VALID_EXTRACTION)).rejects.toMatchObject({
      code: "delivery_disabled",
    });
    expect(opener).not.toHaveBeenCalled();
  });

  it("blocks unknown delivery-prefixed names from legacy dispatch", async () => {
    const legacyDispatch = vi.fn().mockResolvedValue("legacy");
    const dispatch = createDeliveryGuardDispatcher(legacyDispatch);
    await expect(dispatch("codex_web_to_json_admin", {})).rejects.toMatchObject({
      code: "delivery_disabled",
    });
    expect(legacyDispatch).not.toHaveBeenCalled();
  });
});

describe("legacy dispatch passthrough", () => {
  it("delegates non-delivery tools unchanged", async () => {
    const legacyDispatch = vi.fn().mockResolvedValue("legacy-result");
    const dispatch = createDeliveryGuardDispatcher(legacyDispatch);
    await expect(dispatch("codex_catalog_list", {})).resolves.toBe("legacy-result");
    expect(legacyDispatch).toHaveBeenCalledWith("codex_catalog_list", {});
  });

  it("delegates non-delivery tools from the buyer-bound dispatcher", async () => {
    const { dispatch } = harness();
    await expect(dispatch("codex_catalog_list", {})).resolves.toBe("legacy");
  });
});

describe("argument validation", () => {
  it("rejects injected identity or credential fields", async () => {
    const { dispatch, opener } = harness();
    await expect(
      dispatch(DELIVERY_TOOLS.extract, {
        ...VALID_EXTRACTION,
        buyer_id: "buyer-b",
        authorization: "w2j_abcdef",
      }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    expect(opener).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTPS URL", async () => {
    const { dispatch } = harness();
    await expect(
      dispatch(DELIVERY_TOOLS.extract, {
        url: "http://example.test/pricing",
        idempotency_key: "key-001",
      }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("rejects an invalid idempotency key", async () => {
    const { dispatch } = harness();
    await expect(
      dispatch(DELIVERY_TOOLS.extract, {
        url: "https://example.test/pricing",
        idempotency_key: "bad key!",
      }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("rejects an invalid job id", async () => {
    const { dispatch } = harness();
    await expect(
      dispatch(DELIVERY_TOOLS.job, { id: "../etc/passwd" }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("rejects unexpected fields on balance", async () => {
    const { dispatch } = harness();
    await expect(
      dispatch(DELIVERY_TOOLS.balance, { buyer: "b" }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });
});

describe("principal authorization", () => {
  it("rejects an expired principal", async () => {
    const { dispatch, opener } = harness(
      {},
      principal({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    );
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect(opener).not.toHaveBeenCalled();
  });

  it("rejects a wrong-audience principal", async () => {
    const { dispatch } = harness(
      {},
      principal({ audience: "https://other.example.test/mcp" }),
    );
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "authentication_required",
    });
  });

  it("rejects a principal missing the operation scope", async () => {
    const { dispatch, opener } = harness(
      {},
      principal({ scopes: ["web-to-json:read"] }),
    );
    await expect(dispatch(DELIVERY_TOOLS.extract, VALID_EXTRACTION)).rejects.toMatchObject({
      code: "insufficient_permission",
    });
    expect(opener).not.toHaveBeenCalled();
  });
});

describe("buyer session resolution", () => {
  it("opens a session from verified issuer and subject only", async () => {
    const { dispatch, opener } = harness();
    await dispatch(DELIVERY_TOOLS.extract, VALID_EXTRACTION);
    expect(opener).toHaveBeenCalledWith({
      issuer: "https://auth.example.test",
      subject: "buyer-a",
    });
  });

  it("isolates concurrent buyer sessions", async () => {
    const sessionA = mockSession();
    const sessionB = mockSession();
    const opener = vi.fn(async (identity: { subject: string }) =>
      identity.subject === "buyer-a" ? sessionA : sessionB,
    );
    const dispatchA = createBuyerBoundDispatcher(principal({ subject: "buyer-a" }), {
      expectedAudience: AUDIENCE,
      deliveryEnabled: () => true,
      requiredScopes: {
        balance: ["web-to-json:read"],
        extract: ["web-to-json:use"],
        job: ["web-to-json:read"],
      },
      openBuyerSession: opener,
      toPublicResult: (_op, value) => value,
      legacyDispatch: vi.fn(),
    });
    const dispatchB = createBuyerBoundDispatcher(principal({ subject: "buyer-b" }), {
      expectedAudience: AUDIENCE,
      deliveryEnabled: () => true,
      requiredScopes: {
        balance: ["web-to-json:read"],
        extract: ["web-to-json:use"],
        job: ["web-to-json:read"],
      },
      openBuyerSession: opener,
      toPublicResult: (_op, value) => value,
      legacyDispatch: vi.fn(),
    });
    await Promise.all([
      dispatchA(DELIVERY_TOOLS.extract, VALID_EXTRACTION),
      dispatchB(DELIVERY_TOOLS.extract, VALID_EXTRACTION),
    ]);
    expect(sessionA.extract).toHaveBeenCalledTimes(1);
    expect(sessionB.extract).toHaveBeenCalledTimes(1);
  });

  it("denies delivery_failed when no session adapter is configured", async () => {
    const { dispatch } = harness({
      openBuyerSession: undefined,
      toPublicResult: undefined,
    });
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "delivery_failed",
    });
  });

  it("denies delivery_failed when session resolution throws", async () => {
    const { dispatch } = harness({
      openBuyerSession: vi.fn().mockRejectedValue(new Error("no mapping")),
    });
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "delivery_failed",
    });
  });

  it("re-authorizes after credential resolution", async () => {
    let enabled = true;
    const session = mockSession();
    const opener = vi.fn(async () => {
      enabled = false;
      return session;
    });
    const { dispatch } = harness({
      deliveryEnabled: () => enabled,
      openBuyerSession: opener,
    });
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).rejects.toMatchObject({
      code: "delivery_disabled",
    });
    expect(session.balance).not.toHaveBeenCalled();
  });
});

describe("operation execution", () => {
  it("calls extract exactly once with the validated input", async () => {
    const { dispatch, session } = harness();
    const result = await dispatch(DELIVERY_TOOLS.extract, VALID_EXTRACTION);
    expect(session.extract).toHaveBeenCalledTimes(1);
    expect(session.extract).toHaveBeenCalledWith(VALID_EXTRACTION);
    expect(result).toEqual({ job_id: "job_1" });
  });

  it("passes a validated job id", async () => {
    const { dispatch, session } = harness();
    await dispatch(DELIVERY_TOOLS.job, { id: "job_1" });
    expect(session.job).toHaveBeenCalledWith("job_1");
  });

  it("projects results through toPublicResult", async () => {
    const { dispatch } = harness({
      toPublicResult: () => ({ projected: true }),
    });
    await expect(dispatch(DELIVERY_TOOLS.balance, {})).resolves.toEqual({
      projected: true,
    });
  });

  it("denies delivery_failed when a session operation throws", async () => {
    const failingSession = {
      ...mockSession(),
      extract: vi.fn().mockRejectedValue(new Error("upstream")),
    };
    const { dispatch } = harness({
      openBuyerSession: vi.fn().mockResolvedValue(failingSession),
    });
    await expect(dispatch(DELIVERY_TOOLS.extract, VALID_EXTRACTION)).rejects.toMatchObject({
      code: "delivery_failed",
    });
  });
});

describe("dispatcher construction", () => {
  it("throws when required scopes are missing", () => {
    expect(() =>
      harness({
        requiredScopes: {
          balance: [],
          extract: ["web-to-json:use"],
          job: ["web-to-json:read"],
        },
      }),
    ).toThrow();
  });

  it("throws when expectedAudience is empty", () => {
    expect(() =>
      createBuyerBoundDispatcher(principal(), {
        expectedAudience: "",
        requiredScopes: {
          balance: ["web-to-json:read"],
          extract: ["web-to-json:use"],
          job: ["web-to-json:read"],
        },
        legacyDispatch: vi.fn(),
      }),
    ).toThrow();
  });
});
