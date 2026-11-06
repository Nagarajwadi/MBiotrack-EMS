import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadAttendanceReportCsv,
  getAttendanceRecords,
  getAttendanceReport,
  getDailyAttendanceOperations,
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
});
