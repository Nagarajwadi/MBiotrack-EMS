import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeAttendanceException,
  downloadAttendanceReportCsv,
  getAttendanceExceptions,
  getAttendanceRecords,
  getAttendanceReport,
  getAttendanceReviews,
  getDailyAttendanceOperations,
  getTeamAttendanceSummary,
  recordAttendancePunch,
} from './attendanceApi';

describe('attendanceApi client', () => {
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

  it('calls /api/v1/attendance without query params when none are provided', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getAttendanceRecords();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/attendance');
    expect(res).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('correctly constructs query string for pagination and attendance filters', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 40 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getAttendanceRecords({
      limit: 20,
      offset: 40,
      employee_id: 10,
      office_id: 2,
      device_id: 5,
      punch_type: 'CHECK_IN',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      is_roaming: true,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance?');
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=40');
    expect(url).toContain('employee_id=10');
    expect(url).toContain('office_id=2');
    expect(url).toContain('device_id=5');
    expect(url).toContain('punch_type=CHECK_IN');
    expect(url).toContain('start_date=2026-11-01');
    expect(url).toContain('end_date=2026-11-05');
    expect(url).toContain('is_roaming=true');
  });

  it('includes scope parameter in getAttendanceRecords when provided', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 10, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await getAttendanceRecords({
      scope: 'team',
      employee_id: 15,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance?');
    expect(url).toContain('scope=team');
    expect(url).toContain('employee_id=15');
  });

  it('calls getTeamAttendanceSummary with correctly formed query parameters', async () => {
    const mockTeamSummaryResponse = {
      summary: {
        date: '2026-11-15',
        total_events: 4,
        employees_with_punches: 2,
        employees_without_punches: 1,
        requires_review_count: 0,
        roaming_punch_count: 0,
        eligible_employee_count: 3,
      },
      employees: [],
      total_employees: 3,
      limit: 50,
      offset: 0,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockTeamSummaryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getTeamAttendanceSummary({
      date: '2026-11-15',
      employee_id: 5,
      limit: 50,
      offset: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance/team-summary?');
    expect(url).toContain('date=2026-11-15');
    expect(url).toContain('employee_id=5');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=0');
    expect(res).toEqual(mockTeamSummaryResponse);
  });

  it('calls getDailyAttendanceOperations with correctly formed query parameters', async () => {
    const mockSummaryResponse = {
      summary: {
        date: '2026-11-10',
        total_events: 5,
        employees_with_punches: 3,
        employees_without_punches: 2,
        requires_review_count: 1,
        roaming_punch_count: 1,
        eligible_employee_count: 5,
      },
      employees: [],
      total_employees: 5,
      limit: 25,
      offset: 0,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSummaryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getDailyAttendanceOperations({
      date: '2026-11-10',
      office_id: 1,
      employee_id: 2,
      limit: 25,
      offset: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance/daily-summary?');
    expect(url).toContain('date=2026-11-10');
    expect(url).toContain('office_id=1');
    expect(url).toContain('employee_id=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=0');
    expect(res).toEqual(mockSummaryResponse);
  });

  it('calls getAttendanceReport with date range, office, and employee filters', async () => {
    const mockReportResponse = {
      summary: {
        start_date: '2026-11-01',
        end_date: '2026-11-07',
        total_events: 10,
        employees_with_punches: 4,
        employees_without_punches: 1,
        roaming_punch_count: 2,
        total_records: 5,
        eligible_employee_count: 5,
      },
      items: [],
      total_items: 5,
      limit: 50,
      offset: 0,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockReportResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await getAttendanceReport({
      start_date: '2026-11-01',
      end_date: '2026-11-07',
      office_id: 3,
      employee_id: 8,
      limit: 50,
      offset: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance/report?');
    expect(url).toContain('start_date=2026-11-01');
    expect(url).toContain('end_date=2026-11-07');
    expect(url).toContain('office_id=3');
    expect(url).toContain('employee_id=8');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=0');
    expect(res).toEqual(mockReportResponse);
  });

  it('calls downloadAttendanceReportCsv and returns a Blob', async () => {
    const mockCsv = 'Employee Code,Employee Name,Department,Office,Attendance Date,Punch Count,First Punch,Last Punch,Roaming Status\nEMP001,John Doe,Engineering,HQ,2026-11-01,2,2026-11-01 09:00:00 UTC,2026-11-01 17:00:00 UTC,In-Assignment';
    const mockBlob = new Blob([mockCsv], { type: 'text/csv' });

    mockFetch.mockResolvedValueOnce(
      new Response(mockBlob, {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      })
    );

    const blob = await downloadAttendanceReportCsv({
      start_date: '2026-11-01',
      end_date: '2026-11-07',
      office_id: 2,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/attendance/report/export-csv?');
    expect(url).toContain('start_date=2026-11-01');
    expect(url).toContain('end_date=2026-11-07');
    expect(url).toContain('office_id=2');
    expect(init?.headers).toEqual(new Headers({ Accept: 'text/csv' }));
    expect(blob).toBeInstanceOf(Blob);
  });

  it('calls POST /api/v1/attendance/punch with payload and returns punch response', async () => {
    const mockPunchResponse = {
      id: 101,
      employee_id: 1,
      device_id: 2,
      office_id: 3,
      punch_type: 'CHECK_IN',
      event_timestamp: '2026-11-08T09:00:00Z',
      is_roaming: false,
      idempotency_key: 'test-key-123',
      actor_user_id: 1,
      created_at: '2026-11-08T09:00:00Z',
      notes: null,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockPunchResponse), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const payload = {
      employee_id: 1,
      device_id: 2,
      punch_type: 'CHECK_IN' as const,
      idempotency_key: 'test-key-123',
    };

    const res = await recordAttendancePunch(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/attendance/punch');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(payload);
    expect(res).toEqual(mockPunchResponse);
  });

  it('propagates ApiError when recordAttendancePunch fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Device is not active' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(
      recordAttendancePunch({
        employee_id: 1,
        device_id: 99,
        punch_type: 'CHECK_IN',
      })
    ).rejects.toThrow('Device is not active');
  });

  describe('attendance exception review API', () => {
    it('submits attendance exception acknowledgement payload to /api/v1/attendance/reviews', async () => {
      const mockReviewResponse = {
        id: 1,
        employee_id: 10,
        attendance_date: '2026-11-15',
        reviewed_by_user_id: 2,
        reviewer_name: 'Bob Manager',
        reviewer_email: 'bob@example.com',
        review_status: 'ACKNOWLEDGED',
        review_notes: 'Approved off-site client meeting',
        idempotency_key: 'test-idemp-123',
        created_at: '2026-11-15T18:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockReviewResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const payload = {
        employee_id: 10,
        attendance_date: '2026-11-15',
        review_status: 'ACKNOWLEDGED' as const,
        review_notes: 'Approved off-site client meeting',
        idempotency_key: 'test-idemp-123',
      };

      const res = await acknowledgeAttendanceException(payload);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/v1/attendance/reviews');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual(payload);
      expect(res).toEqual(mockReviewResponse);
    });

    it('retrieves employee review history from /api/v1/attendance/reviews', async () => {
      const mockHistory = {
        employee_id: 10,
        total_items: 1,
        items: [
          {
            id: 1,
            employee_id: 10,
            attendance_date: '2026-11-15',
            reviewed_by_user_id: 2,
            reviewer_name: 'Bob Manager',
            reviewer_email: 'bob@example.com',
            review_status: 'ACKNOWLEDGED',
            review_notes: 'Notes',
            idempotency_key: 'key-1',
            created_at: '2026-11-15T18:00:00Z',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockHistory), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await getAttendanceReviews({
        employee_id: 10,
        attendance_date: '2026-11-15',
        limit: 20,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/attendance/reviews');
      expect(url).toContain('employee_id=10');
      expect(url).toContain('date=2026-11-15');
      expect(url).toContain('limit=20');
      expect(init?.method).toBe('GET');
      expect(res).toEqual(mockHistory);
    });

    it('retrieves attendance exceptions from /api/v1/attendance/exceptions', async () => {
      const mockExceptions = {
        date: '2026-11-15',
        total_exceptions: 1,
        items: [],
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockExceptions), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await getAttendanceExceptions({
        date: '2026-11-15',
        limit: 50,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/attendance/exceptions');
      expect(url).toContain('date=2026-11-15');
      expect(url).toContain('limit=50');
      expect(init?.method).toBe('GET');
      expect(res).toEqual(mockExceptions);
    });
  });
});
