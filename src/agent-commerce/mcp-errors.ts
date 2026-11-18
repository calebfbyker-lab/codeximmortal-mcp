import { ApiError } from "./api.js";

const PUBLIC_ERRORS: Readonly<Record<string, number>> = {
  invalid_request: 400, invalid_identifier: 400, unknown_service: 400,
  invalid_document_request: 400, duplicate_field_name: 400,
  distinct_snapshots_required: 400, idempotency_key_required: 400,
  unauthorized: 401, payment_required: 402,
  insufficient_scope: 403, delegation_denied: 403,
  service_not_delegated: 403, spending_limit: 403, not_found: 404,
  idempotency_conflict: 409, quote_expired: 409, quote_mismatch: 409,
  quote_already_used: 409, rate_limited: 429, job_limit: 429,
  service_disabled: 503, service_unpriced: 503,
  commerce_unavailable: 503, dependency_unavailable: 503,
};

export function publicToolError(error: unknown) {
  if (error instanceof ApiError && Object.hasOwn(PUBLIC_ERRORS, error.code) &&
      PUBLIC_ERRORS[error.code] === error.status) {
    return { code: error.code, retryable: error.status === 429 || error.status === 503 };
  }
  return { code: "tool_execution_failed", retryable: false };
}
