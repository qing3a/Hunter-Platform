import type { ErrorCode } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Invalid or missing API key') =>
    new ApiError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Permission denied') =>
    new ApiError('FORBIDDEN', msg, 403),
  notFound: (msg = 'Resource not found') =>
    new ApiError('NOT_FOUND', msg, 404),
  invalidParams: (msg: string, details?: Record<string, unknown>) =>
    new ApiError('INVALID_PARAMS', msg, 400, details),
  insufficientQuota: (msg = 'Daily quota exhausted') =>
    new ApiError('INSUFFICIENT_QUOTA', msg, 429),
  rateLimited: (msg = 'Burst rate limit exceeded', details?: Record<string, unknown>) =>
    new ApiError('RATE_LIMITED', msg, 429, details),
  invalidState: (msg: string) =>
    new ApiError('INVALID_STATE', msg, 409),
  duplicateRequest: (msg = 'Idempotency key reused with different body') =>
    new ApiError('DUPLICATE_REQUEST', msg, 409),
  internal: (msg = 'Internal server error') =>
    new ApiError('INTERNAL_ERROR', msg, 500),
};
