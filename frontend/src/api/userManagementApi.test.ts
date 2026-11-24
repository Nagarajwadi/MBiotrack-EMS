import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from './client';
import { getUsers, createUser, updateUserStatus, updateUserRole } from './userManagementApi';

describe('userManagementApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches users with optional filters', async () => {
    const mockUsers = [
      {
        id: 1,
        employee_id: 10,
        full_name: 'John Doe',
        email: 'john@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(mockUsers);

    const result = await getUsers({ is_active: true, role: 'EMPLOYEE' });
    expect(result).toEqual(mockUsers);
    expect(apiFetchSpy).toHaveBeenCalledWith(
      '/api/v1/users?is_active=true&role=EMPLOYEE',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('creates user with payload', async () => {
    const payload = {
      employee_id: 10,
      role: 'EMPLOYEE' as const,
      initial_password: 'InitialPassword123!',
    };

    const mockCreated = {
      id: 2,
      ...payload,
      full_name: 'Jane Smith',
      email: 'jane@example.com',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(mockCreated);

    const result = await createUser(payload);
    expect(result).toEqual(mockCreated);
    expect(apiFetchSpy).toHaveBeenCalledWith(
      '/api/v1/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    );
  });

  it('updates user status', async () => {
    const mockUpdated = {
      id: 2,
      employee_id: 10,
      full_name: 'Jane Smith',
      email: 'jane@example.com',
      role: 'EMPLOYEE' as const,
      is_active: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(mockUpdated);

    const result = await updateUserStatus(2, { is_active: false });
    expect(result).toEqual(mockUpdated);
    expect(apiFetchSpy).toHaveBeenCalledWith(
      '/api/v1/users/2/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      })
    );
  });

  it('updates user role', async () => {
    const mockUpdated = {
      id: 2,
      employee_id: 10,
      full_name: 'Jane Smith',
      email: 'jane@example.com',
      role: 'MANAGER' as const,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(mockUpdated);

    const result = await updateUserRole(2, { role: 'MANAGER' });
    expect(result).toEqual(mockUpdated);
    expect(apiFetchSpy).toHaveBeenCalledWith(
      '/api/v1/users/2/role',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'MANAGER' }),
      })
    );
  });
});
