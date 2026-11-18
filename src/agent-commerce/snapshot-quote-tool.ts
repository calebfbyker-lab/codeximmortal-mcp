import type { ToolDef } from '../server.js';
import { createHttpApp, type HttpAppOptions } from '../http-app.js';
import { ApiError, type Dependencies } from './api.js';

export function snapshotQuoteTool(): ToolDef {
  return {
    name: 'codex_service_quote',
    description: 'Create a short-lived pricing-snapshot quote for a ready buyer-owned source. Requires commerce:quote. Server resolves price and currency. No charge, reservation or provider execution.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['service','input'],
      properties: {
        service: { type: 'string', const: 'pricing_snapshot' },
        input: { type: 'object', additionalProperties: false, required: ['sourceId'], properties: {
          sourceId: { type: 'string', minLength: 1, maxLength: 128,
            pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$',
            description: 'Existing ready source owned by the authenticated buyer; not a URL.' }
        } }
      }
    }
  };
}
export function withSnapshotQuoteTool(existing: readonly ToolDef[]): ToolDef[] {
  if (existing.some(t => t.name === 'codex_service_quote')) throw new Error('duplicate_service_quote_tool');
  return [...existing, snapshotQuoteTool()];
}

/** Explicit test/sandbox factory; not called by http.ts or any environment flag.
 * Caller must bind only in an isolated test environment. This is not a release gate.
 * Reuses existing auth, scope, quota, exact-input and source/price backend contracts.
 */
export function createSnapshotQuoteSandboxApp(options: HttpAppOptions) {
  const blocked = async (): Promise<never> => { throw new ApiError(503, 'snapshot_quote_only'); };
  const commerce: Dependencies = {
    ...options.commerce,
    backend: {
      quote: async (principal, service, input) => {
        // Runtime enforcement is required; JSON Schema alone is not authorization.
        if (service !== 'pricing_snapshot') throw new ApiError(400, 'unknown_service');
        return options.commerce.backend.quote(principal, service, input);
      },
      submit: blocked, job: blocked, result: blocked
    }
  };
  return createHttpApp({ ...options, tools: withSnapshotQuoteTool(options.tools), commerce });
}
