import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, AUTH_STORAGE_KEY } from './AuthContext';
import { useAuth } from './useAuth';
import * as authApi from '../api/authApi';
import { ApiError } from '../api/apiError';
import {
  mockAdminUser,
  mockInactiveUser,
  mockLoginCredentials,
  mockTokenResponse,
} from '../test/fixtures/authFixtures';

vi.mock('../api/authApi', () => ({
  login: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

describe('AuthContext and useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('throws an error if useAuth is consumed outside of AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider'
    );
  });

  it('initializes in an unauthenticated state with null user and sessionEpoch 0', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.sessionEpoch).toBe(0);
  });

  it('authenticates user and increments sessionEpoch on successful login and /auth/me verification', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login(mockLoginCredentials);
    });

    expect(authApi.login).toHaveBeenCalledTimes(1);
    expect(authApi.login).toHaveBeenCalledWith(mockLoginCredentials);
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(authApi.getCurrentUser).toHaveBeenCalledWith(mockTokenResponse.access_token);

    expect(result.current.status).toBe('authenticated');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(mockAdminUser);
    expect(result.current.sessionEpoch).toBe(1);
  });

  it('stores JWT in sessionStorage on successful login and never writes to localStorage', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login(mockLoginCredentials);
    });

    expect(result.current.isAuthenticated).toBe(true);
    // Verify persistence in sessionStorage under AUTH_STORAGE_KEY
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(mockTokenResponse.access_token);

    // Verify absolute zero persistence in localStorage
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('auth')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('restores authenticated user from sessionStorage on mount when token is valid and active', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Initial state before restoration resolves is 'restoring'
    expect(result.current.status).toBe('restoring');
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(authApi.getCurrentUser).toHaveBeenCalledWith(mockTokenResponse.access_token);
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(mockAdminUser);
    expect(result.current.sessionEpoch).toBe(1);
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(mockTokenResponse.access_token);
  });

  it('removes token from sessionStorage and resets to unauthenticated if token validation returns 401', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(
      new ApiError(401, 'Token expired')
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('unauthenticated');
    });

    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('removes token from sessionStorage and resets to unauthenticated if /auth/me returns inactive user', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockInactiveUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('unauthenticated');
    });

    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('preserves stored token in sessionStorage during temporary network error and allows retry', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(
      new ApiError(0, 'Unable to connect to backend service')
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.restorationError).not.toBeNull();
    });

    // Stored token is NOT destroyed
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(mockTokenResponse.access_token);
    expect(result.current.status).toBe('restoring');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.restorationError).toContain('Unable to connect to backend service');

    // Recover via retryRestoration once network is back
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    await act(async () => {
      await result.current.retryRestoration();
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(mockAdminUser);
    expect(result.current.restorationError).toBeNull();
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(mockTokenResponse.access_token);
  });

  it('prevents duplicate concurrent session restoration calls', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);

    let resolveUser!: (u: typeof mockAdminUser) => void;
    const pendingPromise = new Promise<typeof mockAdminUser>((resolve) => {
      resolveUser = resolve;
    });
    vi.mocked(authApi.getCurrentUser).mockReturnValueOnce(pendingPromise);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.status).toBe('restoring');

    // Trigger concurrent retryRestoration while initial is in flight
    await act(async () => {
      await result.current.retryRestoration();
    });

    // authApi.getCurrentUser should only have been called once
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1);

    // Complete the in-flight request
    await act(async () => {
      resolveUser(mockAdminUser);
      await pendingPromise;
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  it('safely handles unmount during in-flight restoration without throwing', async () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, mockTokenResponse.access_token);

    let resolveUser!: (u: typeof mockAdminUser) => void;
    const pendingPromise = new Promise<typeof mockAdminUser>((resolve) => {
      resolveUser = resolve;
    });
    vi.mocked(authApi.getCurrentUser).mockReturnValueOnce(pendingPromise);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { unmount } = renderHook(() => useAuth(), { wrapper });

    // Unmount while request is pending
    unmount();

    // Resolving after unmount must not throw error
    await act(async () => {
      resolveUser(mockAdminUser);
      await pendingPromise;
    });
  });

  it('leaves state unauthenticated when login endpoint fails', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(401, 'Incorrect email or password')
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.login(mockLoginCredentials);
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeInstanceOf(ApiError);
    expect((caughtError as ApiError).status).toBe(401);
    expect(authApi.getCurrentUser).not.toHaveBeenCalled();

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.sessionEpoch).toBe(0);
  });

  it('rejects login and does not commit state when /auth/me returns inactive user', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockInactiveUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.login(mockLoginCredentials);
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeInstanceOf(ApiError);
    expect((caughtError as ApiError).status).toBe(403);
    expect((caughtError as ApiError).message).toBe('User account is inactive.');

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.sessionEpoch).toBe(0);
  });

  it('leaves state unauthenticated when /auth/me verification request fails', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(
      new ApiError(401, 'Token validation failed')
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.login(mockLoginCredentials);
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeInstanceOf(ApiError);
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('ignores concurrent login calls while authentication is in progress', async () => {
    let resolveLogin: (val: typeof mockTokenResponse) => void = () => {};
    const pendingLoginPromise = new Promise<typeof mockTokenResponse>((resolve) => {
      resolveLogin = resolve;
    });

    vi.mocked(authApi.login).mockReturnValueOnce(pendingLoginPromise);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Initiate first login (in-flight)
    let p1: Promise<void>;
    act(() => {
      p1 = result.current.login(mockLoginCredentials);
    });

    // Attempt second concurrent login
    await act(async () => {
      await result.current.login(mockLoginCredentials);
    });

    // authApi.login should only have been called once
    expect(authApi.login).toHaveBeenCalledTimes(1);

    // Resolve first login
    await act(async () => {
      resolveLogin(mockTokenResponse);
      await p1;
    });

    expect(result.current.isAuthenticated).toBe(true);
  });

  it('resets state immediately, increments sessionEpoch, and notifies backend on logout', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
    vi.mocked(authApi.logout).mockResolvedValueOnce({ message: 'Successfully logged out' });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Step 1: Login
    await act(async () => {
      await result.current.login(mockLoginCredentials);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.sessionEpoch).toBe(1);

    // Step 2: Logout
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.sessionEpoch).toBe(2);
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();

    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(authApi.logout).toHaveBeenCalledWith(mockTokenResponse.access_token);
  });

  it('handles session expiration via 401 and invokes onSessionExpired callback', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

    const onSessionExpiredMock = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider onSessionExpired={onSessionExpiredMock}>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Login
    await act(async () => {
      await result.current.login(mockLoginCredentials);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(mockTokenResponse.access_token);
    const epochAtLogin = result.current.sessionEpoch; // 1

    // Trigger 401 unauthorized handling via simulated client callback
    // (Import configureApiClient to simulate 401 callback)
    const { apiFetch } = await import('../api/client');
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await act(async () => {
        try {
          await apiFetch('/api/v1/employees');
        } catch {
          // Expected 401 ApiError
        }
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.sessionEpoch).toBe(epochAtLogin + 1);
      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(onSessionExpiredMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
