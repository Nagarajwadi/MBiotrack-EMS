import { ApiError, type ApiValidationError } from './apiError';

export type TokenProvider = () => string | null;
export type UnauthorizedCallback = (requestEpoch?: number) => void;
export type EpochProvider = () => number;

let tokenProvider: TokenProvider = () => null;
let unauthorizedCallback: UnauthorizedCallback = () => {};
let epochProvider: EpochProvider = () => 0;

export function configureApiClient(options: {
  getToken: TokenProvider;
  onUnauthorized: UnauthorizedCallback;
  getEpoch?: EpochProvider;
}): void {
  tokenProvider = options.getToken;
  unauthorizedCallback = options.onUnauthorized;
  if (options.getEpoch) {
    epochProvider = options.getEpoch;
  }
}

export interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
  token?: string;
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const parsed = parseInt(headerValue.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function handleResponse<T>(res: Response, endpoint: string, requestEpoch: number): Promise<T> {
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  if (res.ok) {
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, 'Invalid JSON response from server');
    }
  }

  const isLoginEndpoint = endpoint.includes('/auth/login');
  let errorDetail: string | ApiValidationError[] =
    res.statusText || (res.status >= 500 ? 'Internal server error' : 'Request failed');

  let retryAfter: number | undefined;
  if (res.status === 429) {
    retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
  }

  try {
    const errorBody = await res.json();
    if (errorBody && errorBody.detail !== undefined) {
      errorDetail = errorBody.detail;
    }
  } catch {
    // Response body is not valid JSON; fallback to default errorDetail
  }

  // Handle 401 on authenticated endpoints by notifying AuthContext
  if (res.status === 401 && !isLoginEndpoint) {
    unauthorizedCallback(requestEpoch);
  }

  throw new ApiError(res.status, errorDetail, undefined, retryAfter);
}

export async function apiFetch<T>(endpoint: string, options: ApiFetchOptions = {}): Promise<T> {
  const requestEpoch = epochProvider();
  const headers = new Headers(options.headers);

  if (!options.skipAuth) {
    const authToken = options.token ?? tokenProvider();
    if (authToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    // If request was aborted by AbortController, rethrow as is
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    // Network errors (e.g. server unreachable, CORS failure, offline)
    throw new ApiError(
      0,
      'Unable to connect to the backend server. Please verify the FastAPI service is running on port 8000.'
    );
  }

  return await handleResponse<T>(response, endpoint, requestEpoch);
}

