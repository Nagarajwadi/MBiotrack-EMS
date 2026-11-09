import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEmployees,
  reactivateEmployee,
} from './employeeApi';

describe('employeeApi client', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getEmployees requests /api/v1/employees without status by default', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1, employee_code: 'EMP-01', is_active: true }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getEmployees();
    expect(res).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/employees',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('getEmployees requests /api/v1/employees?status=INACTIVE when specified', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 2, employee_code: 'EMP-02', is_active: false }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getEmployees('INACTIVE');
    expect(res).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/employees?status=INACTIVE',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('getEmployees requests /api/v1/employees?status=ALL when specified', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getEmployees('ALL');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/employees?status=ALL',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('reactivateEmployee sends POST to /api/v1/employees/:id/reactivate', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 2, employee_code: 'EMP-02', is_active: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await reactivateEmployee(2);
    expect(res.is_active).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/employees/2/reactivate',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
