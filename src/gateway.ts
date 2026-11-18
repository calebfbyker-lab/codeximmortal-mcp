// Legacy gateway client. The gateway URL MUST be configured explicitly;
// missing configuration fails closed instead of selecting a remote default.
// Only stable, redacted error codes cross this module's boundary.

const GATEWAY_TIMEOUT_MS = 10_000;
const MAX_GATEWAY_RESPONSE_CHARS = 1_000_000;

function resolveGatewayUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const raw = env.CODEX_GATEWAY_URL?.trim();
  if (!raw) throw new Error("gateway_unavailable");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("gateway_unavailable");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("gateway_unavailable");
  }
  if (url.username || url.password) {
    throw new Error("gateway_unavailable");
  }
  return url;
}

interface GatewayEnvelope {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

export async function gatewayRpc(method: string, params: unknown): Promise<unknown> {
  const url = resolveGatewayUrl();
  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CODEX_GATEWAY_TOKEN) {
    headers.authorization = `Bearer ${process.env.CODEX_GATEWAY_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch {
    throw new Error("gateway_unavailable");
  }

  if (!response.ok) throw new Error("gateway_unavailable");

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new Error("gateway_unavailable");
  }
  if (raw.length > MAX_GATEWAY_RESPONSE_CHARS) throw new Error("gateway_unavailable");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("gateway_unavailable");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("gateway_unavailable");
  }
  const body = parsed as GatewayEnvelope;
  if (body.jsonrpc !== "2.0" || body.id !== requestId) {
    throw new Error("gateway_unavailable");
  }
  const hasResult = "result" in body;
  const hasError = "error" in body;
  // A valid JSON-RPC response carries exactly one of result or error.
  if (hasResult === hasError) throw new Error("gateway_unavailable");
  if (hasError) throw new Error("gateway_rejected");
  return body.result;
}

export function callGatewayTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return gatewayRpc("mcp.tools.call", { name, arguments: args });
}
