import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, configureApiClient, type UnauthorizedCallback } from './client';
import { ApiError } from './apiError';

describe('API client (client.ts)', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch = vi.fn<typeof fetch>();
  let mockOnUnauthorized = vi.fn<UnauthorizedCallback>();
  let currentToken: string | null = null;
  let currentEpoch = 1;

  beforeEach(() => {
    currentToken = null;
    currentEpoch = 1;
    mockOnUnauthorized = vi.fn<UnauthorizedCallback>();
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;

    configureApiClient({
      getToken: () => currentToken,
      onUnauthorized: mockOnUnauthorized,
      getEpoch: () => currentEpoch,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Authorization header handling', () => {
    it('injects Bearer token header when tokenProvider returns a token', async () => {
      currentToken = 'test-token-abc';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await apiFetch('/api/v1/resource');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token-abc');
    });

    it('does not inject Authorization header when skipAuth is true', async () => {
      currentToken = 'test-token-abc';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await apiFetch('/api/v1/public', { skipAuth: true });

      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
    });

    it('uses explicit token option when provided, overriding tokenProvider', async () => {
      currentToken = 'default-token';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await apiFetch('/api/v1/auth/me', { token: 'explicit-token-xyz' });

      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer explicit-token-xyz');
    });

    it('does not overwrite existing Authorization header', async () => {
      currentToken = 'token-from-provider';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await apiFetch('/api/v1/custom', {
        headers: { Authorization: 'CustomScheme custom-token' },
      });

      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('CustomScheme custom-token');
    });
  });

  describe('Response parsing', () => {
    it('parses and returns JSON body on successful 200 response', async () => {
      const payload = { id: 10, name: 'Test' };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await apiFetch<typeof payload>('/api/v1/data');
      expect(result).toEqual(payload);
    });

    it('returns undefined on HTTP 204 No Content without parsing JSON', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await apiFetch('/api/v1/resource/1', { method: 'DELETE' });
      expect(result).toBeUndefined();
    });

    it('throws ApiError with status when 200 OK has invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('not-valid-json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      try {
        await apiFetch('/api/v1/bad-json');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiError = err as ApiError;
        expect(apiError.status).toBe(200);
        expect(apiError.message).toBe('Invalid JSON response from server');
      }
    });
  });

  describe('Error response handling and notifications', () => {
    it('handles 401 Unauthorized on authenticated endpoints and notifies callback with requestEpoch', async () => {
      currentEpoch = 7;
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Token has expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(apiFetch('/api/v1/employees')).rejects.toThrow(ApiError);
      expect(mockOnUnauthorized).toHaveBeenCalledTimes(1);
      expect(mockOnUnauthorized).toHaveBeenCalledWith(7);
    });

    it('does NOT trigger unauthorizedCallback when 401 occurs on /auth/login', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Incorrect username or password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(apiFetch('/api/v1/auth/login')).rejects.toThrow(ApiError);
      expect(mockOnUnauthorized).not.toHaveBeenCalled();
    });

    it('handles 403 Forbidden without triggering unauthorizedCallback', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: 'You do not have permission to perform this action' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      const errorPromise = apiFetch('/api/v1/admin-only');
      await expect(errorPromise).rejects.toThrow(ApiError);
      await expect(errorPromise).rejects.toMatchObject({
        status: 403,
        message: 'You do not have permission to perform this action',
      });
      expect(mockOnUnauthorized).not.toHaveBeenCalled();
    });

    it('parses HTTP 422 validation errors with array detail', async () => {
      const validationDetail = [
        { loc: ['body', 'email'], msg: 'Invalid email address', type: 'value_error' },
      ];
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: validationDetail }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      try {
        await apiFetch('/api/v1/employees', { method: 'POST' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiError = err as ApiError;
        expect(apiError.status).toBe(422);
        expect(apiError.detail).toEqual(validationDetail);
        expect(apiError.isValidationError).toBe(true);
        expect(apiError.message).toBe('Invalid email address');
      }
    });

    it('parses Retry-After header on HTTP 429 Too Many Requests', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Too many login attempts. Please wait.' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        })
      );

      try {
        await apiFetch('/api/v1/auth/login', { method: 'POST' });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiError = err as ApiError;
        expect(apiError.status).toBe(429);
        expect(apiError.retryAfter).toBe(60);
      }
    });

    it('falls back to default status text when error response body is non-JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
        })
      );

      await expect(apiFetch('/api/v1/failing')).rejects.toMatchObject({
        status: 502,
        message: 'Bad Gateway',
      });
    });

    it('wraps network disconnect / fetch rejections in user-friendly ApiError', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await apiFetch('/api/v1/offline');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiError = err as ApiError;
        expect(apiError.status).toBe(0);
        expect(apiError.message).toContain('Unable to connect to the backend server');
      }
    });

    it('rethrows AbortError without wrapping in ApiError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(apiFetch('/api/v1/aborted')).rejects.toThrow('The operation was aborted');
    });
  });
});
