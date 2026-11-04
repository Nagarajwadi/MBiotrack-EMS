import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuditLogs } from './auditApi';

describe('auditApi client', () => {
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

  it('calls /api/v1/audit-logs without query params when none are provided', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getAuditLogs();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/audit-logs');
    expect(res).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('correctly constructs query string for pagination and filters', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 50 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getAuditLogs({
      limit: 25,
      offset: 50,
      action: 'EMPLOYEE_CREATE',
      target_type: 'employee',
      actor_user_id: 1,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/audit-logs?');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(url).toContain('action=EMPLOYEE_CREATE');
    expect(url).toContain('target_type=employee');
    expect(url).toContain('actor_user_id=1');
  });
});

