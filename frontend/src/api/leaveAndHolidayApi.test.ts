import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHoliday,
  deleteHoliday,
  getHolidays,
  updateHoliday,
} from './holidayApi';
import {
  cancelLeaveRequest,
  getLeaveRequest,
  getLeaveRequests,
  reviewLeaveRequest,
  submitLeaveRequest,
} from './leaveApi';

describe('leaveApi and holidayApi clients', () => {
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

  it('submits a leave request with correct payload', async () => {
    const mockRes = {
      id: 1,
      employee_id: 10,
      start_date: '2026-11-15',
      end_date: '2026-11-18',
      leave_type: 'ANNUAL',
      status: 'PENDING',
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockRes), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await submitLeaveRequest({
      start_date: '2026-11-15',
      end_date: '2026-11-18',
      leave_type: 'ANNUAL',
      reason: 'Vacation',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/leaves');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      start_date: '2026-11-15',
      end_date: '2026-11-18',
      leave_type: 'ANNUAL',
      reason: 'Vacation',
    });
    expect(res).toEqual(mockRes);
  });

  it('queries leave requests with filters', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getLeaveRequests({
      employee_id: 5,
      status: 'PENDING',
      leave_type: 'SICK',
      limit: 25,
      offset: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/leaves?');
    expect(url).toContain('employee_id=5');
    expect(url).toContain('status=PENDING');
    expect(url).toContain('leave_type=SICK');
  });

  it('fetches a single leave request by id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 5, status: 'PENDING' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getLeaveRequest(5);
    expect(res).toEqual({ id: 5, status: 'PENDING' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/leaves/5');
  });

  it('reviews a leave request with decision payload', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 2, status: 'APPROVED' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await reviewLeaveRequest(2, {
      decision: 'APPROVED',
      decision_notes: 'Looks good',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/leaves/2/review');
    expect(init?.method).toBe('POST');
    expect(res.status).toBe('APPROVED');
  });

  it('cancels a leave request', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 3, status: 'CANCELLED' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await cancelLeaveRequest(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/leaves/3/cancel');
    expect(init?.method).toBe('POST');
    expect(res.status).toBe('CANCELLED');
  });

  it('queries holidays with office and date filters', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getHolidays({
      office_id: 2,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/holidays?');
    expect(url).toContain('office_id=2');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-12-31');
  });

  it('creates, updates, and deletes a holiday', async () => {
    // 1. Create
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 5, name: 'Republic Day' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const created = await createHoliday({
      holiday_date: '2027-01-26',
      name: 'Republic Day',
      office_id: null,
      is_optional: false,
    });
    expect(created.id).toBe(5);

    // 2. Update
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 5, name: 'Republic Day Celebrations' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const updated = await updateHoliday(5, { name: 'Republic Day Celebrations' });
    expect(updated.name).toBe('Republic Day Celebrations');

    // 3. Delete
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteHoliday(5);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [delUrl, delInit] = mockFetch.mock.calls[2];
    expect(delUrl).toBe('/api/v1/holidays/5');
    expect(delInit?.method).toBe('DELETE');
  });
});
