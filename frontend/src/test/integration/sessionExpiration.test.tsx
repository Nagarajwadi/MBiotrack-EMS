import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/apiError';
import { AuthProvider } from '../../context/AuthContext';
import { useAuth } from '../../context/useAuth';
import {
  mockAdminUser,
  mockLoginCredentials,
  mockTokenResponse,
} from '../fixtures/authFixtures';

describe('Integration Tests: Session Expiration, Unauthorized Responses & Stateless Logout', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('Scenario E: Session expiration and unauthorized responses', () => {
    it('clears active session and triggers onSessionExpired when apiFetch receives HTTP 401 on authenticated endpoint', async () => {
      const mockOnSessionExpired = vi.fn();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider onSessionExpired={mockOnSessionExpired}>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Step 1: Login succeeds
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockAdminUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await act(async () => {
        await result.current.login(mockLoginCredentials);
      });

      expect(result.current.status).toBe('authenticated');
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.sessionEpoch).toBe(1);

      // Step 2: Make an authenticated request that returns HTTP 401
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Token has expired.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      let caughtError: unknown;
      await act(async () => {
        try {
          await apiFetch('/api/v1/employees');
        } catch (err) {
          caughtError = err;
        }
      });

      expect(caughtError).toBeInstanceOf(ApiError);
      expect((caughtError as ApiError).status).toBe(401);

      // Verify active session was cleared and onSessionExpired was called
      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.sessionEpoch).toBe(2);
      expect(mockOnSessionExpired).toHaveBeenCalledTimes(1);
    });

    it('stale 401 from a superseded session epoch does NOT log out the current active session', async () => {
      const mockOnSessionExpired = vi.fn();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider onSessionExpired={mockOnSessionExpired}>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Login Session 1
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockAdminUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await act(async () => {
        await result.current.login(mockLoginCredentials);
      });

      expect(result.current.sessionEpoch).toBe(1);

      // Create a deferred response for a request started in Session 1
      let resolveStaleRequest!: (value: Response) => void;
      const staleResponsePromise = new Promise<Response>((res) => {
        resolveStaleRequest = res;
      });

      // Request 1 started in Session 1 (captures epoch 1)
      mockFetch.mockReturnValueOnce(staleResponsePromise);
      let staleApiPromise: Promise<unknown>;
      act(() => {
        staleApiPromise = apiFetch('/api/v1/employees');
      });

      // Session transitions: user logs out (epoch 1 -> 2) and logs in as Session 2 (epoch 2 -> 3)
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Logged out' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await act(async () => {
        await result.current.logout();
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'token-session-2',
              token_type: 'bearer',
              expires_in: 1800,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ...mockAdminUser, id: 99, email: 'admin2@company.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await act(async () => {
        await result.current.login({ email: 'admin2@company.com', password: 'newPassword' });
      });

      expect(result.current.status).toBe('authenticated');
      expect(result.current.user?.email).toBe('admin2@company.com');
      expect(result.current.sessionEpoch).toBe(3);

      // Now resolve the stale request from Session 1 with HTTP 401
      await act(async () => {
        resolveStaleRequest(
          new Response(JSON.stringify({ detail: 'Token has expired.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        );
        try {
          await staleApiPromise!;
        } catch {
          // Expected ApiError from stale request
        }
      });

      // Session 2 is NOT logged out: stale 401 with outdated epoch was ignored
      expect(result.current.status).toBe('authenticated');
      expect(result.current.user?.email).toBe('admin2@company.com');
      expect(result.current.sessionEpoch).toBe(3);
      expect(mockOnSessionExpired).not.toHaveBeenCalled();
    });

    it('HTTP 403 Forbidden does NOT clear an otherwise valid active session', async () => {
      const mockOnSessionExpired = vi.fn();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider onSessionExpired={mockOnSessionExpired}>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Authenticate
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockAdminUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await act(async () => {
        await result.current.login(mockLoginCredentials);
      });

      expect(result.current.status).toBe('authenticated');

      // Perform an operation that returns 403 Forbidden
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Access denied: insufficient permissions.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      let caughtError: unknown;
      await act(async () => {
        try {
          await apiFetch('/api/v1/employees/forbidden-endpoint');
        } catch (err) {
          caughtError = err;
        }
      });

      expect(caughtError).toBeInstanceOf(ApiError);
      expect((caughtError as ApiError).status).toBe(403);

      // Active session remains fully intact
      expect(result.current.status).toBe('authenticated');
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockAdminUser);
      expect(mockOnSessionExpired).not.toHaveBeenCalled();
    });

    it('stateless logout immediately clears client session even if backend logout fails or network drops', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Authenticate
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockAdminUser), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      await act(async () => {
        await result.current.login(mockLoginCredentials);
      });

      expect(result.current.status).toBe('authenticated');

      // Backend /auth/logout fails with 500 Internal Server Error
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Backend database unreachable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Client logout must not throw and must still clean local session
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('HTTP 401 on /auth/login endpoint does NOT trigger unauthorizedCallback or session expired handler', async () => {
      const mockOnSessionExpired = vi.fn();
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider onSessionExpired={mockOnSessionExpired}>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Incorrect username or password.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await act(async () => {
        await expect(
          result.current.login({ email: 'bad@company.com', password: 'wrong' })
        ).rejects.toThrow('Incorrect username or password.');
      });

      expect(mockOnSessionExpired).not.toHaveBeenCalled();
      expect(result.current.status).toBe('unauthenticated');
    });
  });
});
