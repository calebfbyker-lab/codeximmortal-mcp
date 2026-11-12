import { Pool } from "pg";
import { ApiError, createAgentCommerceRouter, type Dependencies } from "./api.js";
import { createBase44Dependencies } from "./base44-authority.js";
import { createIntrospector } from "./introspection.js";
import { postgresLimiter } from "./postgres-rate-limit.js";
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim(); if (!value) throw new Error(`missing_configuration:${key}`); return value;
}
export function agentCommerceFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  // Safe default: no connections, calls or credential requirements when disabled.
  if (env.AGENT_COMMERCE_ENABLED !== "true") {
    const blocked = async (): Promise<never> => { throw new ApiError(503, "service_disabled"); };
    const dependencies: Dependencies = { enabled: false, authenticate: blocked, consume: blocked, backend: { quote: blocked, submit: blocked, job: blocked, result: blocked } };
    return { router: createAgentCommerceRouter(dependencies), dependencies, close: async () => undefined };
  }
  if (env.AGENT_COMMERCE_AUTHORITY_CONTRACT !== "agent-commerce-authority-v1-reviewed") throw new Error("authority_contract_not_reviewed");
  const endpoint = required(env, "AGENT_COMMERCE_AUTHORITY_URL"), serviceToken = required(env, "AGENT_COMMERCE_SERVICE_TOKEN");
  const issuer = required(env, "AGENT_AUTH_ISSUER");
  const authenticateSubject = createIntrospector({ endpoint: required(env, "AGENT_AUTH_INTROSPECTION_URL"), clientId: required(env, "AGENT_AUTH_CLIENT_ID"), clientSecret: required(env, "AGENT_AUTH_CLIENT_SECRET"), audience: required(env, "AGENT_AUTH_AUDIENCE"), issuer });
  const pool = new Pool({ connectionString: required(env, "AGENT_RATE_LIMIT_DATABASE_URL"), max: 5, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000 });
  pool.on("error", () => { console.error(JSON.stringify({ event: "agent_rate_pool_error" })); });
  const dependencies = createBase44Dependencies({ endpoint, serviceToken, issuer, authenticateSubject, consume: postgresLimiter(pool) });
  return { router: createAgentCommerceRouter(dependencies), dependencies, close: () => pool.end() };
}
