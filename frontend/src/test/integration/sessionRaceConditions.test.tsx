import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import * as authApi from '../../api/authApi';
import * as employeeApi from '../../api/employeeApi';
import { ApiError } from '../../api/apiError';
import { EmployeeProfileView } from '../../components/EmployeeProfileView';
import { AuthProvider } from '../../context/AuthContext';
import { useAuth } from '../../context/useAuth';
import type { Employee } from '../../types/employee';
import type { TokenResponse } from '../../types/auth';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockInactiveUser,
  mockManagerUser,
  mockTokenResponse,
} from '../fixtures/authFixtures';
import {
  mockEmployee1,
  mockEmployee2,
  mockEmployee3,
  mockEmployeesList,
} from '../fixtures/employeeFixtures';

vi.mock('../../api/authApi', () => ({
  login: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../api/employeeApi', () => ({
  getHealth: vi.fn(),
  getEmployees: vi.fn(),
  getEmployee: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Integration & Race Condition Tests: Session Lifecycle and UI Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(employeeApi.getHealth).mockResolvedValue({
      status: 'ok',
      application: 'mbiotrack-backend',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('Scenario A: Logout while a request is pending', () => {
    it('discards in-flight directory request when user logs out before it resolves', async () => {
      const user = userEvent.setup();
      const deferredEmployees = createDeferred<Employee[]>();
      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
      vi.mocked(employeeApi.getEmployees).mockReturnValueOnce(deferredEmployees.promise);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      // Initial unauthenticated view
      expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Submit login as ADMIN
      await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'AdminPassword123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      // Directory header displays while table is loading
      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /loading employees/i })).toBeInTheDocument();

      // Click Sign Out while getEmployees is still pending
      const logoutBtn = screen.getByRole('button', { name: /sign out/i });
      await user.click(logoutBtn);

      // UI immediately transitions to LoginForm
      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Resolve the late getEmployees request with mock data
      await act(async () => {
        deferredEmployees.resolve(mockEmployeesList);
      });

      // Verify the session was NOT restored and no stale employee records render
      expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /employee directory/i })).not.toBeInTheDocument();
      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();
    });

    it('discards in-flight employee profile request when user logs out before it resolves', async () => {
      const user = userEvent.setup();
      const deferredProfile = createDeferred<Employee>();
      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockEmployeeUser);
      vi.mocked(employeeApi.getEmployee).mockReturnValueOnce(deferredProfile.promise);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email address/i), 'employee@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'EmployeePassword123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      // Profile spinner is in-flight
      expect(await screen.findByRole('progressbar', { name: /loading profile/i })).toBeInTheDocument();

      // Sign out while profile request is pending
      const logoutBtn = screen.getByRole('button', { name: /sign out/i });
      await user.click(logoutBtn);

      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Resolve late profile response
      await act(async () => {
        deferredProfile.resolve(mockEmployee3);
      });

      // Verify profile view and private employee data are not restored
      expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
      expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
      expect(screen.queryByText(mockEmployee3.employee_code)).not.toBeInTheDocument();
    });
  });

  describe('Scenario B: Stale responses after logout', () => {
    it('ignores late successful directory response after logout and prevents repopulating authenticated UI state', async () => {
      const user = userEvent.setup();
      const deferredEmployees = createDeferred<Employee[]>();
      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
      vi.mocked(employeeApi.getEmployees).mockReturnValueOnce(deferredEmployees.promise);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'AdminPassword123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /sign out/i }));
      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Resolve late response
      await act(async () => {
        deferredEmployees.resolve(mockEmployeesList);
      });

      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();
      expect(screen.queryByText(mockEmployee2.employee_code)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
    });

    it('ignores late failed request (500 error) after logout without displaying error banner on login screen', async () => {
      const user = userEvent.setup();
      const deferredEmployees = createDeferred<Employee[]>();
      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
      vi.mocked(employeeApi.getEmployees).mockReturnValueOnce(deferredEmployees.promise);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'AdminPassword123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /sign out/i }));
      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Reject late response with 500 error
      await act(async () => {
        deferredEmployees.reject(new ApiError(500, 'Database query failed unexpectedly'));
      });

      // Error banner belonging to previous session is NOT rendered on the login screen
      expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
      expect(screen.queryByText(/database query failed unexpectedly/i)).not.toBeInTheDocument();
      expect(document.querySelector('.alert-banner.error')).not.toBeInTheDocument();
    });
  });

  describe('Scenario C: User A to User B session isolation', () => {
    it('clears User A (ADMIN) directory data completely when User B (EMPLOYEE) authenticates, enforcing role permissions and UI isolation', async () => {
      const user = userEvent.setup();

      // Step 1: User A (ADMIN)
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-admin-1',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'Pass123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      // User A (ADMIN) sees directory and management actions
      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ add employee/i })).toBeInTheDocument();
      expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();

      // Step 2: User A logs out
      await user.click(screen.getByRole('button', { name: /sign out/i }));
      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Step 3: User B (EMPLOYEE) authenticates
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-emp-2',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockEmployeeUser);
      vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee3);

      await user.type(screen.getByLabelText(/email address/i), 'employee@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'Pass123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      // User B view renders personal profile
      expect(await screen.findByRole('heading', { name: /charlie brown/i })).toBeInTheDocument();
      expect(screen.getByText('Charlie Employee')).toBeInTheDocument();
      expect(screen.getByText('EMPLOYEE')).toBeInTheDocument();

      // Complete isolation: User A's data, directory, and buttons are NOT visible
      expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /employee directory/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /\+ add employee/i })).not.toBeInTheDocument();
      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();
    });

    it('switches from User A to User B: outgoing requests strictly use User B token', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Authenticate User A
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-user-a-111',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

      await act(async () => {
        await result.current.login({ email: 'a@mbiotrack.local', password: 'password123' });
      });

      expect(authApi.getCurrentUser).toHaveBeenCalledWith('token-user-a-111');
      expect(result.current.user?.id).toBe(mockAdminUser.id);

      // Logout User A
      vi.mocked(authApi.logout).mockResolvedValueOnce({ message: 'Logged out successfully' });
      await act(async () => {
        await result.current.logout();
      });

      expect(authApi.logout).toHaveBeenCalledWith('token-user-a-111');
      expect(result.current.user).toBeNull();
      expect(result.current.status).toBe('unauthenticated');

      // Authenticate User B
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-user-b-222',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockEmployeeUser);

      await act(async () => {
        await result.current.login({ email: 'b@mbiotrack.local', password: 'password456' });
      });

      expect(authApi.getCurrentUser).toHaveBeenLastCalledWith('token-user-b-222');
      expect(result.current.user?.id).toBe(mockEmployeeUser.id);
    });
  });

  describe('Scenario D: Concurrent login protection', () => {
    it('drops duplicate concurrent login calls while first login is pending', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      const deferredLogin = createDeferred<TokenResponse>();
      vi.mocked(authApi.login).mockReturnValue(deferredLogin.promise);
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockAdminUser);

      // Trigger first login (unawaited)
      let login1Promise: Promise<void>;
      act(() => {
        login1Promise = result.current.login({ email: 'user1@company.com', password: 'password1' });
      });

      expect(result.current.status).toBe('authenticating');

      // Attempt second login immediately while first is in-flight
      let login2Promise: Promise<void>;
      act(() => {
        login2Promise = result.current.login({ email: 'user2@company.com', password: 'password2' });
      });

      // Concurrent call was dropped: authApi.login called only once
      expect(authApi.login).toHaveBeenCalledTimes(1);

      // Resolve first login
      await act(async () => {
        deferredLogin.resolve(mockTokenResponse);
        await login1Promise!;
        await login2Promise!;
      });

      expect(result.current.status).toBe('authenticated');
      expect(result.current.user?.email).toBe(mockAdminUser.email);
    });

    it('resets authentication state and releases concurrency lock when login fails, allowing subsequent login attempt', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // First login fails with 401
      vi.mocked(authApi.login).mockRejectedValueOnce(new ApiError(401, 'Invalid email or password.'));

      await act(async () => {
        await expect(
          result.current.login({ email: 'bad@company.com', password: 'wrong' })
        ).rejects.toThrow('Invalid email or password.');
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);

      // Second login succeeds immediately without lock contention
      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);

      await act(async () => {
        await result.current.login({ email: 'good@company.com', password: 'correct' });
      });

      expect(result.current.status).toBe('authenticated');
      expect(result.current.user).toEqual(mockAdminUser);
    });

    it('cleans state and releases lock when /auth/me returns inactive user error', async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      vi.mocked(authApi.login).mockResolvedValueOnce(mockTokenResponse);
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockInactiveUser);

      await act(async () => {
        await expect(
          result.current.login({ email: 'inactive@company.com', password: 'secret' })
        ).rejects.toThrow('User account is inactive.');
      });

      expect(result.current.status).toBe('unauthenticated');
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('Scenario F: Session epoch and request ordering', () => {
    it('discards out-of-order responses from an obsolete session when resolving after a newer session request', async () => {
      const user = userEvent.setup();
      const deferredReq1 = createDeferred<Employee[]>();
      const deferredReq2 = createDeferred<Employee[]>();

      // Session 1: Admin logs in
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-admin-session-1',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockAdminUser);
      vi.mocked(employeeApi.getEmployees).mockReturnValueOnce(deferredReq1.promise);

      render(
        <AuthProvider>
          <App />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email address/i), 'admin1@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'Pass1!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      // Req 1 is in-flight

      // User 1 signs out
      await user.click(screen.getByRole('button', { name: /sign out/i }));
      expect(await screen.findByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();

      // Session 2: Manager logs in
      vi.mocked(authApi.login).mockResolvedValueOnce({
        access_token: 'token-mgr-session-2',
        token_type: 'bearer',
        expires_in: 1800,
      });
      vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(mockManagerUser);
      vi.mocked(employeeApi.getEmployees).mockReturnValueOnce(deferredReq2.promise);

      await user.type(screen.getByLabelText(/email address/i), 'mgr2@mbiotrack.local');
      await user.type(screen.getByLabelText(/password/i), 'Pass2!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();

      // Resolve Request 2 FIRST with Session 2 dataset ([mockEmployee2])
      await act(async () => {
        deferredReq2.resolve([mockEmployee2]);
      });

      expect(await screen.findByText(mockEmployee2.employee_code)).toBeInTheDocument();
      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();

      // Resolve Request 1 AFTERWARDS with Session 1 dataset ([mockEmployee1]) out of order
      await act(async () => {
        deferredReq1.resolve([mockEmployee1]);
      });

      // Session 2 data is preserved; obsolete Session 1 response was safely discarded
      expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();
      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();
    });

    it('EmployeeProfileView ignores out-of-order response when employeeId / epoch changes', async () => {
      const deferred1 = createDeferred<Employee>();
      const deferred2 = createDeferred<Employee>();

      vi.mocked(employeeApi.getEmployee)
        .mockReturnValueOnce(deferred1.promise)
        .mockReturnValueOnce(deferred2.promise);

      const { rerender } = render(
        <EmployeeProfileView employeeId={1} sessionEpoch={1} />
      );

      expect(screen.getByRole('progressbar', { name: /loading profile/i })).toBeInTheDocument();

      // Re-render with new employeeId and incremented sessionEpoch
      rerender(<EmployeeProfileView employeeId={2} sessionEpoch={2} />);

      // Resolve Request 2 first with mockEmployee2 (John Smith)
      await act(async () => {
        deferred2.resolve(mockEmployee2);
      });

      expect(await screen.findByRole('heading', { name: /john smith/i })).toBeInTheDocument();
      expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();

      // Resolve Request 1 afterwards with mockEmployee1 (Jane Doe)
      await act(async () => {
        deferred1.resolve(mockEmployee1);
      });

      // Still John Smith, Jane Doe did not overwrite
      expect(screen.getByRole('heading', { name: /john smith/i })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /jane doe/i })).not.toBeInTheDocument();
    });
  });
});
