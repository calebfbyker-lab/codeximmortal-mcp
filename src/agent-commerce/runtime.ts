import { Pool } from "pg";
import { ApiError, createAgentCommerceRouter, type Dependencies } from "./api.js";
import { PostgresCommerce } from "./postgres-commerce.js";
import { createIntrospector } from "./introspection.js";
import { postgresLimiter } from "./postgres-rate-limit.js";
import { createAgentFundingRouter, type FundingRouterDependencies } from "./funding-router.js";
import { PostgresFundingOrders } from "./postgres-funding-orders.js";
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value=env[key]?.trim(); if(!value) throw new Error(`missing_configuration:${key}`); return value;
}
export function agentCommerceFromEnvironment(env: NodeJS.ProcessEnv=process.env) {
  const blocked=async (): Promise<never> => {throw new ApiError(503,"service_disabled");};
  if(env.AGENT_COMMERCE_ENABLED!=="true") {
    const dependencies: Dependencies={enabled:false,authenticate:blocked,consume:blocked,backend:{quote:blocked,submit:blocked,job:blocked,result:blocked}};
    const funding: FundingRouterDependencies={enabled:false,authenticate:blocked,consume:blocked,backend:{create:blocked}};
    return {router:createAgentCommerceRouter(dependencies),dependencies,fundingRouter:createAgentFundingRouter(funding),funding,close:async()=>undefined};
  }
  if(env.AGENT_COMMERCE_AUTHORITY_CONTRACT!=="postgres-commerce-v1-reviewed") throw new Error("authority_contract_not_reviewed");
  const issuer=required(env,"AGENT_AUTH_ISSUER");
  const introspect=createIntrospector({endpoint:required(env,"AGENT_AUTH_INTROSPECTION_URL"),clientId:required(env,"AGENT_AUTH_CLIENT_ID"),clientSecret:required(env,"AGENT_AUTH_CLIENT_SECRET"),audience:required(env,"AGENT_AUTH_AUDIENCE"),issuer});
  const pool=new Pool({connectionString:required(env,"AGENT_COMMERCE_DATABASE_URL"),max:10,connectionTimeoutMillis:3000,idleTimeoutMillis:30000,statement_timeout:5000});
  pool.on("error",()=>console.error(JSON.stringify({event:"agent_commerce_pool_error"})));
  const backend=new PostgresCommerce(pool);
  const dependencies: Dependencies={enabled:true,authenticate:async token=>backend.resolve(issuer,await introspect(token)),consume:postgresLimiter(pool),backend};
  const funding: FundingRouterDependencies={enabled:env.FUNDING_API_ENABLED==="true",authenticate:dependencies.authenticate,consume:postgresLimiter(pool),backend:new PostgresFundingOrders(pool)};
  return {router:createAgentCommerceRouter(dependencies),dependencies,fundingRouter:createAgentFundingRouter(funding),funding,close:()=>pool.end()};
}
