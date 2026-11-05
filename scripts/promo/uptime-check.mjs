#!/usr/bin/env node
// Standalone uptime monitor for the codeximmortal-mcp service.
// Zero dependencies: Node 20+ (global fetch). Exits nonzero on failure.
const SERVICE_URL = process.env.SERVICE_URL ?? "https://codeximmortal-mcp.onrender.com";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60000);
const RETRY_DELAY_MS = 10_000;

async function checkOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL("/healthz", SERVICE_URL), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    const ok = response.status === 200 && body !== null && body.ok === true;
    return {
      ok,
      status: response.status,
      ms: Date.now() - startedAt,
      tools: body && typeof body.tools === "number" ? body.tools : null,
      offers: body && typeof body.offers === "number" ? body.offers : null,
      body: ok ? undefined : text.slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - startedAt,
      errorType: error instanceof Error ? error.name : "Unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

let result = await checkOnce();
if (!result.ok) {
  // Free-tier cold starts can take tens of seconds; retry once.
  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  result = await checkOnce();
}
console.log(JSON.stringify({
  event: "uptime_check",
  timestamp: new Date().toISOString(),
  serviceUrl: SERVICE_URL,
  ...result,
}));
process.exit(result.ok ? 0 : 1);
