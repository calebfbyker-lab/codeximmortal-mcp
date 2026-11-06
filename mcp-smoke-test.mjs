import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(
  "https://codeximmortal-mcp.onrender.com/mcp"
);

const client = new Client(
  {
    name: "codeximmortal-smoke-test",
    version: "1.0.0",
  },
  {
    capabilities: {},
  }
);

const transport = new StreamableHTTPClientTransport(endpoint);
const startedAt = Date.now();

// Stop the test if connection, discovery, or cleanup hangs.
const watchdog = setTimeout(() => {
  console.error("FAIL: test exceeded 120 seconds.");
  process.exit(1);
}, 120_000);

try {
  console.log(`Connecting to ${endpoint.href}`);

  await client.connect(transport, {
    timeout: 90_000,
  });

  console.log(
    "PASS: MCP initialization",
    JSON.stringify(client.getServerVersion())
  );

  const names = [];
  const seenCursors = new Set();
  let cursor;

  do {
    const page = await client.listTools(
      cursor ? { cursor } : {},
      { timeout: 30_000 }
    );

    names.push(...page.tools.map(tool => tool.name));
    cursor = page.nextCursor;

    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("Server repeated a pagination cursor.");
      }

      seenCursors.add(cursor);
    }
  } while (cursor);

  if (names.length === 0) {
    throw new Error("tools/list returned no tools.");
  }

  console.log(`PASS: tools/list returned ${names.length} tools`);

  for (const name of names) {
    console.log(`  - ${name}`);
  }

  console.log(`Finished in ${Date.now() - startedAt} ms`);
} catch (error) {
  console.error(
    "FAIL:",
    error instanceof Error ? error.message : String(error)
  );

  process.exitCode = 1;
} finally {
  try {
    await client.close();
  } catch (error) {
    console.error(
      "FAIL: client cleanup:",
      error instanceof Error ? error.message : String(error)
    );

    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
}
