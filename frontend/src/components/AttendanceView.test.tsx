import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as attendanceApi from '../api/attendanceApi';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
} from '../test/fixtures/authFixtures';
import type {
  AttendanceListResponse,
  AttendanceReportResponse,
  DailyAttendanceOperationsResponse,
} from '../types/attendance';
import { AttendanceView } from './AttendanceView';

describe('AttendanceView component', () => {
  const sampleEventResponse: AttendanceListResponse = {
    items: [
      {
        id: 101,
        employee_id: 1,
        employee_code: 'EMP-001',
        employee_name: 'Alice Smith',
        department: 'Engineering',
        device_id: 10,
        device_name: 'Turnstile A',
        device_code: 'DEV-A',
        office_id: 5,
        office_name: 'Headquarters',
        office_code: 'HQ',
        punch_type: 'CHECK_IN',
        event_timestamp: '2026-11-05T09:00:00Z',
        is_roaming: false,
        idempotency_key: 'key-101',
        actor_user_id: 1,
        created_at: '2026-11-05T09:00:01Z',
      },
      {
        id: 102,
        employee_id: 1,
        employee_code: 'EMP-001',
        employee_name: 'Alice Smith',
        department: 'Engineering',
        device_id: 20,
        device_name: 'Terminal Roam',
        device_code: 'DEV-ROAM',
        office_id: 8,
        office_name: 'Branch East',
        office_code: 'BR-E',
        punch_type: 'CHECK_OUT',
        event_timestamp: '2026-11-05T18:00:00Z',
        is_roaming: true,
        idempotency_key: 'key-102',
        actor_user_id: 1,
        created_at: '2026-11-05T18:00:01Z',
      },
    ],
    total: 2,
    limit: 25,
    offset: 0,
  };

  const sampleDailyOpsResponse: DailyAttendanceOperationsResponse = {
    summary: {
      date: '2026-11-10',
      total_events: 3,
      employees_with_punches: 2,
      employees_without_punches: 1,
      requires_review_count: 1,
      roaming_punch_count: 1,
      eligible_employee_count: 3,
    },
    employees: [
      {
        employee_id: 1,
        employee_code: 'EMP-001',
        employee_name: 'Alice Smith',
        department: 'Engineering',
        assigned_office_id: 1,
        assigned_office_name: 'Headquarters',
        assigned_office_code: 'HQ',
        punch_count: 2,
        first_punch: '2026-11-10T09:00:00Z',
        last_punch: '2026-11-10T18:00:00Z',
        has_roaming: false,
        roaming_count: 0,
        review_status: 'NORMAL',
        review_reason: null,
        punches: [
          {
            id: 101,
            punch_type: 'CHECK_IN',
            event_timestamp: '2026-11-10T09:00:00Z',
            device_id: 1,
            device_name: 'HQ Turnstile',
            device_code: 'DEV-HQ',
            office_id: 1,
            office_name: 'Headquarters',
            office_code: 'HQ',
            is_roaming: false,
          },
          {
            id: 102,
            punch_type: 'CHECK_OUT',
            event_timestamp: '2026-11-10T18:00:00Z',
            device_id: 1,
            device_name: 'HQ Turnstile',
            device_code: 'DEV-HQ',
            office_id: 1,
            office_name: 'Headquarters',
            office_code: 'HQ',
            is_roaming: false,
          },
        ],
      },
      {
        employee_id: 2,
        employee_code: 'EMP-002',
        employee_name: 'Bob Roamer',
        department: 'Sales',
        assigned_office_id: 1,
        assigned_office_name: 'Headquarters',
        assigned_office_code: 'HQ',
        punch_count: 1,
        first_punch: '2026-11-10T10:00:00Z',
        last_punch: '2026-11-10T10:00:00Z',
        has_roaming: true,
        roaming_count: 1,
        review_status: 'REQUIRES_REVIEW',
        review_reason: 'Roaming punches recorded (1)',
        punches: [
          {
            id: 103,
            punch_type: 'CHECK_IN',
            event_timestamp: '2026-11-10T10:00:00Z',
            device_id: 2,
            device_name: 'Branch Terminal',
            device_code: 'DEV-BR',
            office_id: 2,
            office_name: 'Branch North',
            office_code: 'BR',
            is_roaming: true,
          },
        ],
      },
      {
        employee_id: 3,
        employee_code: 'EMP-003',
        employee_name: 'Charlie Absent',
        department: 'HR',
        assigned_office_id: 1,
        assigned_office_name: 'Headquarters',
        assigned_office_code: 'HQ',
        punch_count: 0,
        first_punch: null,
        last_punch: null,
        has_roaming: false,
        roaming_count: 0,
        review_status: 'NO_PUNCH',
        review_reason: null,
        punches: [],
      },
    ],
    total_employees: 3,
    limit: 25,
    offset: 0,
  };

  const sampleReportResponse: AttendanceReportResponse = {
    summary: {
      start_date: '2026-11-01',
      end_date: '2026-11-07',
      total_events: 5,
      employees_with_punches: 2,
      employees_without_punches: 1,
      roaming_punch_count: 1,
      total_records: 3,
      eligible_employee_count: 3,
    },
    items: [
      {
        employee_id: 1,
        employee_code: 'EMP-001',
        employee_name: 'Alice Smith',
        department: 'Engineering',
        office_id: 1,
        office_name: 'Headquarters',
        office_code: 'HQ',
        attendance_date: '2026-11-01',
        punch_count: 2,
        first_punch: '2026-11-01T09:00:00Z',
        last_punch: '2026-11-01T17:00:00Z',
        has_roaming: false,
        roaming_count: 0,
        status: 'NORMAL',
      },
      {
        employee_id: 1,
        employee_code: 'EMP-001',
        employee_name: 'Alice Smith',
        department: 'Engineering',
        office_id: 2,
        office_name: 'Branch East',
        office_code: 'BR-E',
        attendance_date: '2026-11-02',
        punch_count: 1,
        first_punch: '2026-11-02T10:00:00Z',
        last_punch: '2026-11-02T10:00:00Z',
        has_roaming: true,
        roaming_count: 1,
        status: 'NORMAL',
      },
      {
        employee_id: 2,
        employee_code: 'EMP-002',
        employee_name: 'Bob Jones',
        department: 'Support',
        office_id: 1,
        office_name: 'Headquarters',
        office_code: 'HQ',
        attendance_date: '2026-11-01',
        punch_count: 0,
        first_punch: null,
        last_punch: null,
        has_roaming: false,
        roaming_count: 0,
        status: 'NO_PUNCH',
      },
    ],
    total_items: 3,
    limit: 25,
    offset: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Slice 7: Daily Attendance Operations & Summary Tests
  // =========================================================================
  describe('Daily Attendance Operations & Summary (Slice 7)', () => {
    it('renders loading state initially while fetching daily operations', () => {
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockImplementation(
        () => new Promise(() => {}) // never resolves to keep loading state
      );

      render(<AttendanceView currentUser={mockEmployeeUser} sessionEpoch={1} />);

      expect(screen.getByRole('progressbar', { name: /loading daily operations/i })).toBeInTheDocument();
      expect(screen.getByText('Loading Daily Operations...')).toBeInTheDocument();
    });

    it('renders role-appropriate headers for Daily Operations', async () => {
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockResolvedValue(sampleDailyOpsResponse);

      const { rerender } = render(<AttendanceView currentUser={mockEmployeeUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'My Daily Attendance' })).toBeInTheDocument();
      });
      expect(screen.queryByLabelText(/filter by employee id/i)).not.toBeInTheDocument();

      rerender(<AttendanceView currentUser={mockManagerUser} sessionEpoch={1} />);
      expect(screen.getByRole('heading', { level: 2, name: 'Daily Attendance Operations' })).toBeInTheDocument();
      expect(screen.getByLabelText(/filter by employee id/i)).toBeInTheDocument();

      rerender(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Organization Daily Attendance Operations' })
      ).toBeInTheDocument();
    });

    it('renders daily summary cards with correct metrics and neutral "No punch recorded" label', async () => {
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockResolvedValue(sampleDailyOpsResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('card-total-events')).toHaveTextContent('3');
      });

      expect(screen.getByTestId('card-employees-with-punches')).toHaveTextContent('2');
      // Neutral label check: "No Punch Recorded"
      expect(screen.getByTestId('card-employees-without-punches')).toHaveTextContent('1');
      expect(screen.getByTestId('card-employees-without-punches')).toHaveTextContent(/no punch recorded/i);
      expect(screen.getByTestId('card-requires-review')).toHaveTextContent('1');
      expect(screen.getByTestId('card-roaming-punches')).toHaveTextContent('1');
    });

    it('renders employee rows with correct roaming indicator and review statuses', async () => {
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockResolvedValue(sampleDailyOpsResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('row-emp-EMP-001')).toBeInTheDocument();
      });

      // Alice: Normal
      const rowAlice = screen.getByTestId('row-emp-EMP-001');
      expect(rowAlice).toHaveTextContent('Alice Smith');
      expect(rowAlice).toHaveTextContent('2 punches');
      expect(rowAlice).toHaveTextContent('In-Assignment');
      expect(rowAlice).toHaveTextContent('Normal');

      // Bob: Roaming
      const rowBob = screen.getByTestId('row-emp-EMP-002');
      expect(rowBob).toHaveTextContent('Bob Roamer');
      expect(rowBob).toHaveTextContent('1 punch');
      expect(rowBob).toHaveTextContent(/roaming \(1\)/i);
      expect(rowBob).toHaveTextContent('Requires Review');

      // Charlie: No Punch Recorded
      const rowCharlie = screen.getByTestId('row-emp-EMP-003');
      expect(rowCharlie).toHaveTextContent('Charlie Absent');
      expect(rowCharlie).toHaveTextContent('0 punches');
      expect(rowCharlie).toHaveTextContent('No punch recorded');
    });

    it('allows opening and closing the punch inspection modal for roaming review', async () => {
      const user = userEvent.setup();
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockResolvedValue(sampleDailyOpsResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('row-emp-EMP-002')).toBeInTheDocument();
      });

      // Click "Inspect Punches" for Bob
      const inspectBtn = screen.getByRole('button', { name: /inspect punches for bob roamer/i });
      await user.click(inspectBtn);

      // Verify modal content
      expect(screen.getByRole('dialog', { name: /punch details: bob roamer/i })).toBeInTheDocument();
      expect(screen.getByText(/roaming activity detected \(gov-08\)/i)).toBeInTheDocument();
      expect(screen.getByText('Branch Terminal')).toBeInTheDocument();

      // Close modal
      const closeBtn = screen.getByRole('button', { name: /close punch inspection modal/i });
      await user.click(closeBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('submits daily operations filters correctly and resets them on request', async () => {
      const user = userEvent.setup();
      const getDailyOpsSpy = vi
        .spyOn(attendanceApi, 'getDailyAttendanceOperations')
        .mockResolvedValue(sampleDailyOpsResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(getDailyOpsSpy).toHaveBeenCalledTimes(1);
      });

      // Change date
      const dateInput = screen.getByLabelText(/filter by attendance date/i);
      await user.clear(dateInput);
      await user.type(dateInput, '2026-11-15');

      // Change employee ID
      const empInput = screen.getByLabelText(/filter by employee id/i);
      await user.type(empInput, '42');

      const applyBtn = screen.getByRole('button', { name: /apply filters/i });
      await user.click(applyBtn);

      await waitFor(() => {
        expect(getDailyOpsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            date: '2026-11-15',
            employee_id: 42,
          })
        );
      });

      // Reset filters
      const resetBtn = screen.getByRole('button', { name: /reset filters/i });
      await user.click(resetBtn);

      await waitFor(() => {
        expect(getDailyOpsSpy).toHaveBeenCalledTimes(3);
      });
    });

    it('renders error banner when daily operations API fails and allows retry', async () => {
      const user = userEvent.setup();
      const getDailyOpsSpy = vi
        .spyOn(attendanceApi, 'getDailyAttendanceOperations')
        .mockRejectedValueOnce(new Error('Failed to load daily operations telemetry'))
        .mockResolvedValueOnce(sampleDailyOpsResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText('Failed to load daily operations telemetry')).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      await user.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
      expect(getDailyOpsSpy).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Slice 5: Event Feed Tests (Switching to or Mounted in 'events' Tab)
  // =========================================================================
  describe('Event Feed Tab (Slice 5)', () => {
    it('renders loading state initially while fetching attendance records on events tab', () => {
      vi.spyOn(attendanceApi, 'getAttendanceRecords').mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      render(
        <AttendanceView
          currentUser={mockEmployeeUser}
          sessionEpoch={1}
          initialTab="events"
        />
      );

      expect(screen.getByRole('progressbar', { name: /loading attendance records/i })).toBeInTheDocument();
      expect(screen.getByText('Loading Attendance Records...')).toBeInTheDocument();
    });

    it('renders role-appropriate header for EMPLOYEE on events tab', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceRecords').mockResolvedValue(sampleEventResponse);

      render(
        <AttendanceView
          currentUser={mockEmployeeUser}
          sessionEpoch={1}
          initialTab="events"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'My Attendance History' })).toBeInTheDocument();
      });

      expect(screen.queryByLabelText(/filter by employee id/i)).not.toBeInTheDocument();
    });

    it('renders role-appropriate header for MANAGER and ADMIN on events tab', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceRecords').mockResolvedValue(sampleEventResponse);

      const { rerender } = render(
        <AttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
          initialTab="events"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Attendance Records' })).toBeInTheDocument();
      });
      expect(screen.getByLabelText(/filter by employee id/i)).toBeInTheDocument();

      rerender(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="events"
        />
      );

      expect(screen.getByRole('heading', { level: 2, name: 'Organization Attendance Records' })).toBeInTheDocument();
      expect(screen.getByLabelText(/filter by employee id/i)).toBeInTheDocument();
    });

    it('renders table rows with distinct roaming badges (GOV-08) and in-assignment badges', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceRecords').mockResolvedValue(sampleEventResponse);

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="events"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('table', { name: /attendance events list/i })).toBeInTheDocument();
      });

      // In-Assignment badge
      const assignedBadge = screen.getByTestId('assigned-badge');
      expect(assignedBadge).toBeInTheDocument();
      expect(assignedBadge).toHaveTextContent(/in-assignment/i);

      // Roaming badge (GOV-08)
      const roamingBadge = screen.getByTestId('roaming-badge');
      expect(roamingBadge).toBeInTheDocument();
      expect(roamingBadge).toHaveTextContent(/roaming \(gov-08\)/i);
    });

    it('allows switching between Daily Operations and Event Feed tabs', async () => {
      const user = userEvent.setup();
      vi.spyOn(attendanceApi, 'getDailyAttendanceOperations').mockResolvedValue(sampleDailyOpsResponse);
      const getRecordsSpy = vi.spyOn(attendanceApi, 'getAttendanceRecords').mockResolvedValue(sampleEventResponse);

      render(<AttendanceView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Organization Daily Attendance Operations' })).toBeInTheDocument();
      });

      // Switch to Event Feed
      const eventFeedTab = screen.getByRole('tab', { name: /event feed/i });
      await user.click(eventFeedTab);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Organization Attendance Records' })).toBeInTheDocument();
      });
      expect(getRecordsSpy).toHaveBeenCalledTimes(1);

      // Switch back to Daily Operations
      const dailyOpsTab = screen.getByRole('tab', { name: /daily operations & summary/i });
      await user.click(dailyOpsTab);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Organization Daily Attendance Operations' })).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Slice 8: Attendance Reports & CSV Export Tests
  // =========================================================================
  describe('Attendance Reports & CSV Export (Slice 8)', () => {
    it('renders attendance report summary cards and report table', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceReport').mockResolvedValue(sampleReportResponse);

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'Organization Attendance Reports' })
        ).toBeInTheDocument();
      });

      // Verify summary cards
      expect(screen.getByTestId('card-report-total-events')).toHaveTextContent('5');
      expect(screen.getByTestId('card-report-employees-with-punches')).toHaveTextContent('2');
      expect(screen.getByTestId('card-report-employees-without-punches')).toHaveTextContent('1');
      expect(screen.getByTestId('card-report-roaming-punches')).toHaveTextContent('1');
      expect(screen.getByTestId('card-report-date-range')).toHaveTextContent('2026-11-01 to 2026-11-07');

      // Verify report table and neutral statuses
      expect(screen.getByRole('table', { name: /attendance report records/i })).toBeInTheDocument();
      expect(screen.getByTestId('report-row-EMP-001-2026-11-01')).toBeInTheDocument();
      expect(screen.getByTestId('report-row-EMP-002-2026-11-01')).toBeInTheDocument();

      // Check neutral wording for no punch
      expect(screen.getAllByText(/No Punch Recorded/i).length).toBeGreaterThan(0);
    });

    it('allows date range and office filtering', async () => {
      const user = userEvent.setup();
      const reportSpy = vi
        .spyOn(attendanceApi, 'getAttendanceReport')
        .mockResolvedValue(sampleReportResponse);

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'Organization Attendance Reports' })
        ).toBeInTheDocument();
      });

      const startDateInput = screen.getByLabelText(/filter by report start date/i);
      const endDateInput = screen.getByLabelText(/filter by report end date/i);
      const officeInput = screen.getByLabelText(/filter by office/i);

      await user.clear(startDateInput);
      await user.type(startDateInput, '2026-11-01');
      await user.clear(endDateInput);
      await user.type(endDateInput, '2026-11-10');
      await user.type(officeInput, '1');

      const submitBtn = screen.getByRole('button', { name: /generate report/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(reportSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            start_date: '2026-11-01',
            end_date: '2026-11-10',
            office_id: 1,
          })
        );
      });
    });

    it('displays validation warning when date range exceeds 31 days', async () => {
      const user = userEvent.setup();
      const reportSpy = vi
        .spyOn(attendanceApi, 'getAttendanceReport')
        .mockResolvedValue(sampleReportResponse);

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'Organization Attendance Reports' })
        ).toBeInTheDocument();
      });

      const initialCallCount = reportSpy.mock.calls.length;

      const startDateInput = screen.getByLabelText(/filter by report start date/i);
      const endDateInput = screen.getByLabelText(/filter by report end date/i);

      await user.clear(startDateInput);
      await user.type(startDateInput, '2026-10-01');
      await user.clear(endDateInput);
      await user.type(endDateInput, '2026-11-15');

      const submitBtn = screen.getByRole('button', { name: /generate report/i });
      await user.click(submitBtn);

      expect(
        await screen.findByText(/date range exceeds 31-day limit/i)
      ).toBeInTheDocument();
      // Should not make a new API request
      expect(reportSpy.mock.calls.length).toBe(initialCallCount);
    });

    it('triggers CSV export download on button click', async () => {
      const user = userEvent.setup();
      vi.spyOn(attendanceApi, 'getAttendanceReport').mockResolvedValue(sampleReportResponse);
      const csvBlob = new Blob(['Employee Code,Employee Name\nEMP-001,Alice Smith'], {
        type: 'text/csv',
      });
      const exportSpy = vi
        .spyOn(attendanceApi, 'downloadAttendanceReportCsv')
        .mockResolvedValue(csvBlob);

      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-uuid');
      const mockRevokeObjectURL = vi.fn();
      window.URL.createObjectURL = mockCreateObjectURL;
      window.URL.revokeObjectURL = mockRevokeObjectURL;

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('export-csv-btn')).toBeInTheDocument();
      });

      const exportBtn = screen.getByTestId('export-csv-btn');
      await user.click(exportBtn);

      await waitFor(() => {
        expect(exportSpy).toHaveBeenCalledTimes(1);
        expect(mockCreateObjectURL).toHaveBeenCalledWith(csvBlob);
        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
      });
    });

    it('displays role-appropriate titles and filters', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceReport').mockResolvedValue(sampleReportResponse);

      const { rerender } = render(
        <AttendanceView
          currentUser={mockEmployeeUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 2, name: 'My Attendance Reports' })
        ).toBeInTheDocument();
      });
      // Employee should not have employee id filter input
      expect(screen.queryByLabelText(/filter by employee id/i)).not.toBeInTheDocument();

      rerender(
        <AttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      expect(
        screen.getByRole('heading', { level: 2, name: 'Attendance Reports' })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/filter by employee id/i)).toBeInTheDocument();

      rerender(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      expect(
        screen.getByRole('heading', { level: 2, name: 'Organization Attendance Reports' })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/filter by employee id/i)).toBeInTheDocument();
    });

    it('displays empty state when no report items are found', async () => {
      vi.spyOn(attendanceApi, 'getAttendanceReport').mockResolvedValue({
        summary: {
          start_date: '2026-11-01',
          end_date: '2026-11-07',
          total_events: 0,
          employees_with_punches: 0,
          employees_without_punches: 0,
          roaming_punch_count: 0,
          total_records: 0,
          eligible_employee_count: 0,
        },
        items: [],
        total_items: 0,
        limit: 25,
        offset: 0,
      });

      render(
        <AttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialTab="reports"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No Report Records Found')).toBeInTheDocument();
      });
    });
  });
});
