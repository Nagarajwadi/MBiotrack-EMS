import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
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

  it('strictly retains JWT in memory and never writes tokens to localStorage or sessionStorage', async () => {
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
    // Verify no persistence in browser storage
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('auth')).toBeNull();
    expect(localStorage.length).toBe(0);

    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(sessionStorage.length).toBe(0);
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
      expect(onSessionExpiredMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
