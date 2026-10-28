const GATEWAY_URL = process.env.CODEX_GATEWAY_URL ?? "https://mcp.codeximmortal.com/mcp";

export async function gatewayRpc(method: string, params: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CODEX_GATEWAY_TOKEN) {
    headers.authorization = `Bearer ${process.env.CODEX_GATEWAY_TOKEN}`;
  }

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });

  const body = (await res.json().catch(() => null)) as
    | { result?: unknown; error?: { code?: number; message?: string } }
    | null;

  if (!body) {
    throw new Error(`gateway HTTP ${res.status} (no JSON body)`);
  }
  if (body.error) {
    throw new Error(`[${body.error.code ?? "?"}] ${body.error.message ?? "gateway error"}`);
  }
  return body.result;
}

export function callGatewayTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return gatewayRpc("mcp.tools.call", { name, arguments: args });
}
