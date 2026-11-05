#!/usr/bin/env node
// Daily Bazaar ranking snapshot. Queries the public CDP Bazaar MCP
// discovery endpoint (unauthenticated) for search terms and records
// whether this service appears. Zero dependencies: Node 20+.
const MCP_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp";
const SERVICE_URL = process.env.SERVICE_URL ?? "https://codeximmortal-mcp.onrender.com";
const SEARCH_TERMS = (process.env.SEARCH_TERMS ??
  "pricing,pricing extraction,extraction,scraping,software pricing")
  .split(",").map(term => term.trim()).filter(Boolean);
const TIMEOUT_MS = 30_000;

async function callSearch(term, argumentName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_resources",
          arguments: { [argumentName]: term },
        },
      }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let payload = null;
    if (contentType.includes("text/event-stream")) {
      const frames = text.split(/\r?\n/)
        .filter(line => line.startsWith("data:"));
      for (const frame of frames.reverse()) {
        try {
          const parsed = JSON.parse(frame.slice(5).trim());
          if (parsed && parsed.id === 1) { payload = parsed; break; }
        } catch {}
      }
    } else {
      try { payload = JSON.parse(text); } catch {}
    }
    return {
      status: response.status,
      payload,
      raw: payload ? undefined : text.slice(0, 200),
    };
  } catch (error) {
    return { errorType: error instanceof Error ? error.name : "Unknown" };
  } finally {
    clearTimeout(timer);
  }
}

// Defensive: recursively collect objects that look like catalog
// resources (string url or resource field). Never throws on shape.
function collectResources(node, out, depth) {
  if (depth > 8 || out.length > 500) return;
  if (Array.isArray(node)) {
    for (const item of node) collectResources(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (typeof node.url === "string" || typeof node.resource === "string") {
    out.push(node);
  }
  for (const value of Object.values(node)) {
    collectResources(value, out, depth + 1);
  }
}

function summarize(term, call) {
  if (call.errorType) return { term, transport: call.errorType };
  if (call.status !== 200) return { term, transport: `http_${call.status}` };
  if (call.payload && call.payload.error) {
    return {
      term,
      transport: `rpc_error:${String(call.payload.error.message ??
        call.payload.error.code).slice(0, 80)}`,
    };
  }
  const result = call.payload && call.payload.result;
  if (!result) return { term, transport: "no_result", raw: call.raw };
  const resources = [];
  collectResources(result, resources, 0);
  if (!resources.length) {
    return {
      term,
      transport: "no_resources",
      resultType: Array.isArray(result.content) ? "content" : typeof result,
    };
  }
  const urls = resources.map(r => String(r.url ?? r.resource));
  const host = new URL(SERVICE_URL).host;
  const matchIndex = urls.findIndex(u => u.includes(host));
  return {
    term,
    transport: "ok",
    resourceCount: resources.length,
    present: matchIndex >= 0,
    rank: matchIndex >= 0 ? matchIndex + 1 : null,
    matchedUrl: matchIndex >= 0 ? urls[matchIndex] : null,
    topThree: urls.slice(0, 3),
  };
}

const report = {
  event: "bazaar_ranking",
  timestamp: new Date().toISOString(),
  serviceUrl: SERVICE_URL,
  terms: [],
};
for (const term of SEARCH_TERMS) {
  // Try the documented semantic-search argument first; fall back to an
  // alternate shape if the server rejects it. The snapshot records any
  // transport error so the first live run tells us the accepted shape.
  let call = await callSearch(term, "query");
  const primaryFailed = Boolean(call.errorType) || call.status !== 200 ||
    Boolean(call.payload && call.payload.error);
  if (primaryFailed) {
    const fallback = await callSearch(term, "search");
    const fallbackOk = !fallback.errorType && fallback.status === 200 &&
      !(fallback.payload && fallback.payload.error);
    if (fallbackOk) call = fallback;
  }
  report.terms.push(summarize(term, call));
}
console.log(JSON.stringify(report));
