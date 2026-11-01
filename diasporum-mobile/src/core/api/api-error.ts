/**
 * Normalized API error model.
 * Maps HTTP/network failures to a consistent shape used throughout the app.
 * Follows the backend ApiError contract (see SecurityConfig / MeController).
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Shape returned by the Diasporum Spring Boot backend for error responses. */
export interface BackendErrorBody {
  code?: string;
  message?: string;
  errors?: { field?: string; message?: string }[];
  timestamp?: string;
  path?: string;
}

export interface ValidationFieldError {
  readonly field?: string;
  readonly message: string;
}

export class ApiError extends Error {
  readonly httpStatus?: number;
  readonly code: ApiErrorCode;
  /** Safe message for display (never raw backend stack traces). */
  readonly userMessage: string;
  readonly validationErrors?: ValidationFieldError[];

  constructor(params: {
    code: ApiErrorCode;
    httpStatus?: number;
    message?: string;
    userMessage?: string;
    validationErrors?: ValidationFieldError[];
  }) {
    super(params.message ?? params.code);
    this.name = 'ApiError';
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.userMessage = params.userMessage ?? defaultMessage(params.code);
    this.validationErrors = params.validationErrors;
  }

  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.httpStatus === 401;
  }

  get isForbidden(): boolean {
    return this.code === 'FORBIDDEN' || this.httpStatus === 403;
  }

  get isNotFound(): boolean {
    return this.code === 'NOT_FOUND' || this.httpStatus === 404;
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  static fromHttpResponse(status: number, body: BackendErrorBody): ApiError {
    const code = httpStatusToCode(status);
    const validationErrors = body.errors?.map((e) => ({
      field: e.field,
      message: e.message ?? 'Invalid value',
    }));
    return new ApiError({
      code,
      httpStatus: status,
      message: body.message,
      validationErrors,
    });
  }

  static networkError(cause?: unknown): ApiError {
    return new ApiError({
      code: 'NETWORK_ERROR',
      message: `Network error: ${String(cause)}`,
    });
  }

  static isApiError(err: unknown): err is ApiError {
    return err instanceof ApiError;
  }
}

function httpStatusToCode(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 422 || status === 400) return 'VALIDATION_ERROR';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

function defaultMessage(code: ApiErrorCode): string {
  const messages: Record<ApiErrorCode, string> = {
    UNAUTHENTICATED: 'You are not signed in.',
    FORBIDDEN: 'You do not have permission to perform this action.',
    NOT_FOUND: 'The requested resource was not found.',
    VALIDATION_ERROR: 'Please check your input and try again.',
    SERVER_ERROR: 'A server error occurred. Please try again later.',
    NETWORK_ERROR: 'A network error occurred. Please check your connection.',
    TIMEOUT: 'The request timed out. Please try again.',
    UNKNOWN: 'An unexpected error occurred.',
  };
  return messages[code];
}
