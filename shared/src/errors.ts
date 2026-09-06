/**
 * Error codes and their HTTP status mapping.
 * See specs/001-password-manager/contracts/README.md.
 */

export const ERROR_STATUS = {
  // 400
  VALIDATION_FAILED: 400,
  ENVELOPE_MALFORMED: 400,
  // 401
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 401,
  TOTP_REQUIRED: 401,
  TOTP_INVALID: 401,
  REAUTH_REQUIRED: 401,
  // 403
  VAULT_FORBIDDEN: 403,
  ROLE_INSUFFICIENT: 403,
  OFFLINE_WRITE_REFUSED: 403,
  // 404
  NOT_FOUND: 404,
  // 409
  REVISION_CONFLICT: 409,
  KEY_VERSION_STALE: 409,
  LAST_OWNER: 409,
  ROTATION_IN_PROGRESS: 409,
  INVITATION_EXISTS: 409,
  INVITATION_NOT_READY: 409,
  // 422
  TEMPLATE_FIELD_DUPLICATE: 422,
  TEMPLATE_FIELD_IN_USE: 422,
  // 429
  RATE_LIMITED: 429,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return this.details
      ? { error: { code: this.code, message: this.message, details: this.details } }
      : { error: { code: this.code, message: this.message } };
  }
}

/**
 * FR-030: resources the caller may not access return NOT_FOUND, identical to a resource that
 * does not exist, so membership is not enumerable. Never return VAULT_FORBIDDEN for a vault
 * the caller is not a member of — that discloses the vault exists.
 */
export const notFound = () => new ApiError('NOT_FOUND', 'Not found');

/** FR-003: identical response for unknown account and wrong password. */
export const authFailed = () => new ApiError('AUTH_FAILED', 'Authentication failed');
