import { ApiError, type Principal } from "./api.js";
export interface AuthConfig { endpoint: string; clientId: string; clientSecret: string; audience: string; issuer: string }
export function createIntrospector(c: AuthConfig, request: typeof fetch = fetch) {
  const url = new URL(c.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !c.clientId || !c.clientSecret || !c.audience || !c.issuer) throw new Error("invalid_auth_configuration");
  return async (token: string): Promise<Principal> => {
    if (!token || token.length > 8192) throw new ApiError(401, "unauthorized");
    let v: Record<string, unknown>;
    try {
      const response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000), headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString("base64")}`
      }, body: new URLSearchParams({ token, token_type_hint: "access_token" }) });
      if (!response.ok || !response.body) throw new Error("auth_unavailable");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const r = await reader.read(); if (r.done) break;
        bytes += r.value.byteLength;
        if (bytes > 16384) { await reader.cancel(); throw new Error("oversized"); }
        chunks.push(r.value);
      }
      v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("invalid_response");
    } catch { throw new ApiError(503, "auth_unavailable"); }
    const audiences = Array.isArray(v.aud) ? v.aud : [v.aud];
    if (v.active !== true || v.iss !== c.issuer || !audiences.includes(c.audience) || typeof v.exp !== "number" || !Number.isFinite(v.exp) || v.exp <= Date.now()/1000 || (v.nbf !== undefined && (typeof v.nbf !== "number" || !Number.isFinite(v.nbf) || v.nbf > Date.now()/1000)) || typeof v.sub !== "string" || !v.sub || typeof v.client_id !== "string" || !v.client_id || typeof v.scope !== "string" || String(v.token_type).toLowerCase() !== "bearer") throw new ApiError(401, "unauthorized");
    // Provision sub as the canonical buyer; never accept buyer identity from tool input.
    return { buyerId: v.sub, clientId: v.client_id, scopes: v.scope.split(/\s+/).filter(Boolean) };
  };
}
