export interface ApiValidationError {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

export class ApiError extends Error {
  public status: number;
  public detail: string | ApiValidationError[];
  public retryAfter?: number;

  constructor(
    status: number,
    detail: string | ApiValidationError[],
    message?: string,
    retryAfter?: number
  ) {
    const formattedMessage =
      message ||
      (typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((e) => e.msg || 'Validation error').join('; ')
          : 'API request failed');

    super(formattedMessage);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidationError(): boolean {
    return this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

