import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerTeamAttendanceView } from './ManagerTeamAttendanceView';
import * as attendanceApi from '../api/attendanceApi';
import { ApiError } from '../api/apiError';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
  mockUnlinkedManagerUser,
} from '../test/fixtures/authFixtures';
import type { DailyAttendanceOperationsResponse } from '../types/attendance';

vi.mock('../api/attendanceApi', () => ({
  getTeamAttendanceSummary: vi.fn(),
  acknowledgeAttendanceException: vi.fn(),
  getAttendanceReviews: vi.fn(),
  getAttendanceCorrections: vi.fn(),
  reviewAttendanceCorrection: vi.fn(),
}));

const mockTeamAttendanceData: DailyAttendanceOperationsResponse = {
  summary: {
    date: '2026-11-15',
    total_events: 5,
    employees_with_punches: 2,
    employees_without_punches: 1,
    requires_review_count: 1,
    roaming_punch_count: 1,
    eligible_employee_count: 3,
  },
  total_employees: 3,
  limit: 100,
  offset: 0,
  employees: [
    {
      employee_id: 101,
      employee_code: 'EMP-001',
      employee_name: 'Alice InTeam',
      department: 'Engineering',
      assigned_office_id: 1,
      assigned_office_name: 'HQ Campus',
      assigned_office_code: 'HQ-01',
      punch_count: 2,
      first_punch: '2026-11-15T09:00:00Z',
      last_punch: '2026-11-15T17:30:00Z',
      has_roaming: false,
      roaming_count: 0,
      review_status: 'NORMAL',
      review_reason: null,
      punches: [
        {
          id: 1,
          punch_type: 'CHECK_IN',
          event_timestamp: '2026-11-15T09:00:00Z',
          device_id: 10,
          device_name: 'Main Turnstile',
          device_code: 'BIO-01',
          office_id: 1,
          office_name: 'HQ Campus',
          office_code: 'HQ-01',
          is_roaming: false,
        },
        {
          id: 2,
          punch_type: 'CHECK_OUT',
          event_timestamp: '2026-11-15T17:30:00Z',
          device_id: 10,
          device_name: 'Main Turnstile',
          device_code: 'BIO-01',
          office_id: 1,
          office_name: 'HQ Campus',
          office_code: 'HQ-01',
          is_roaming: false,
        },
      ],
    },
    {
      employee_id: 102,
      employee_code: 'EMP-002',
      employee_name: 'Bob CurrentlyIn',
      department: 'Engineering',
      assigned_office_id: 1,
      assigned_office_name: 'HQ Campus',
      assigned_office_code: 'HQ-01',
      punch_count: 1,
      first_punch: '2026-11-15T09:15:00Z',
      last_punch: '2026-11-15T09:15:00Z',
      has_roaming: true,
      roaming_count: 1,
      review_status: 'REQUIRES_REVIEW',
      review_reason: 'Roaming punch outside assigned office',
      punches: [
        {
          id: 3,
          punch_type: 'CHECK_IN',
          event_timestamp: '2026-11-15T09:15:00Z',
          device_id: 20,
          device_name: 'North Gate Turnstile',
          device_code: 'BIO-02',
          office_id: 2,
          office_name: 'Branch North',
          office_code: 'BR-NORTH',
          is_roaming: true,
        },
      ],
    },
    {
      employee_id: 103,
      employee_code: 'EMP-003',
      employee_name: 'Charlie Absent',
      department: 'Engineering',
      assigned_office_id: 1,
      assigned_office_name: 'HQ Campus',
      assigned_office_code: 'HQ-01',
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
};

describe('ManagerTeamAttendanceView', () => {
  const mockGetTeamSummary = vi.mocked(attendanceApi.getTeamAttendanceSummary);
  const mockAcknowledgeException = vi.mocked(attendanceApi.acknowledgeAttendanceException);
  const mockGetAttendanceReviews = vi.mocked(attendanceApi.getAttendanceReviews);
  const mockGetCorrections = vi.mocked(attendanceApi.getAttendanceCorrections);
  const mockReviewCorrection = vi.mocked(attendanceApi.reviewAttendanceCorrection);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCorrections.mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });

  describe('Authorization and Access Control', () => {
    it('restricts access for EMPLOYEE role and displays clear error banner', () => {
      render(
        <ManagerTeamAttendanceView
          currentUser={mockEmployeeUser}
          sessionEpoch={1}
        />
      );

      expect(
        screen.getByText(/Access Restricted: Team attendance overview is only available to Managers and Administrators/i)
      ).toBeInTheDocument();
      expect(mockGetTeamSummary).not.toHaveBeenCalled();
    });

    it('displays unlinked manager notice when manager has no employee_id', () => {
      render(
        <ManagerTeamAttendanceView
          currentUser={mockUnlinkedManagerUser}
          sessionEpoch={1}
        />
      );

      expect(
        screen.getByText(/Your manager user account is not linked to an employee staff profile/i)
      ).toBeInTheDocument();
      expect(mockGetTeamSummary).not.toHaveBeenCalled();
    });

    it('allows access for ADMIN without requiring employee_id link', async () => {
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockAdminUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByText(/Team Attendance Overview/i)).toBeInTheDocument();
    });
  });

  describe('Data Loading and Overview Rendering', () => {
    it('fetches team summary on mount and renders aggregate metrics', async () => {
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      // Loading state
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // Wait for data load
      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      });

      // Verify aggregate summary metrics
      expect(screen.getByText('3')).toBeInTheDocument(); // Total
      expect(screen.getByText('Total Team Members')).toBeInTheDocument();
      expect(screen.getAllByText('Checked In').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Checked Out').length).toBeGreaterThan(0);
      expect(screen.getByText('Not Yet Checked In')).toBeInTheDocument();
      expect(screen.getByText('Requires Review')).toBeInTheDocument();

      // Verify department badge
      expect(screen.getByText(/Department: Engineering/i)).toBeInTheDocument();
    });

    it('renders team attendance table rows with employee info and punch status', async () => {
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      // Alice: Checked Out
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
      expect(screen.getByText('View Punches (2)')).toBeInTheDocument();

      // Bob: Checked In with roaming exception
      expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      expect(screen.getByText('EMP-002')).toBeInTheDocument();
      expect(
        screen.getByText(/Roaming punch outside assigned office/i)
      ).toBeInTheDocument();

      // Charlie: Not Checked In
      expect(screen.getByText('Charlie Absent')).toBeInTheDocument();
      expect(screen.getByText('EMP-003')).toBeInTheDocument();
      expect(screen.getByText('View Punches (0)')).toBeInTheDocument();
    });
  });

  describe('Search and Filter Controls', () => {
    it('filters employees by search query (name or code)', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      const searchInput = screen.getByLabelText(/Search team members/i);
      await user.type(searchInput, 'Bob');

      expect(screen.queryByText('Alice InTeam')).not.toBeInTheDocument();
      expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      expect(screen.queryByText('Charlie Absent')).not.toBeInTheDocument();
    });

    it('filters employees by status pills (Checked In, Checked Out, Not In, Review)', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      // Filter: Checked In (Bob only)
      const checkedInBtn = screen.getByRole('button', { name: /^Checked In \(1\)$/i });
      await user.click(checkedInBtn);

      expect(screen.queryByText('Alice InTeam')).not.toBeInTheDocument();
      expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      expect(screen.queryByText('Charlie Absent')).not.toBeInTheDocument();

      // Filter: Not In (Charlie only)
      const notInBtn = screen.getByRole('button', { name: /^Not In \(1\)$/i });
      await user.click(notInBtn);

      expect(screen.queryByText('Alice InTeam')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob CurrentlyIn')).not.toBeInTheDocument();
      expect(screen.getByText('Charlie Absent')).toBeInTheDocument();

      // Filter: All (Restores all)
      const allBtn = screen.getByRole('button', { name: /^All \(3\)$/i });
      await user.click(allBtn);

      expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      expect(screen.getByText('Charlie Absent')).toBeInTheDocument();
    });

    it('renders empty state when no employees match filters', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      const searchInput = screen.getByLabelText(/Search team members/i);
      await user.type(searchInput, 'NonExistentPerson');

      expect(screen.getByText(/No team members match the selected criteria/i)).toBeInTheDocument();

      // Reset button clears filter
      const resetBtn = screen.getByRole('button', { name: /Reset Filters/i });
      await user.click(resetBtn);

      expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
    });
  });

  describe('Employee Punch Details Drilldown Modal', () => {
    it('opens punch details modal when clicking View Punches and displays full timeline', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      const viewBtn = screen.getByTitle(/Inspect punch details for Alice InTeam/i);
      await user.click(viewBtn);

      // Modal dialog opened
      const modal = screen.getByRole('dialog', { name: /Alice InTeam/i });
      expect(modal).toBeInTheDocument();
      expect(screen.getByText(/Detailed Punch Log/i)).toBeInTheDocument();
      expect(screen.getAllByText('Main Turnstile').length).toBe(2);
      expect(screen.getAllByText(/✓ In-Assignment/i).length).toBe(2);

      // Close modal
      const backBtn = screen.getByRole('button', { name: /← Back to Team Overview/i });
      await user.click(backBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('displays roaming exception notice inside punch detail modal for roaming employee', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      });

      const viewBobBtn = screen.getByTitle(/Inspect punch details for Bob CurrentlyIn/i);
      await user.click(viewBobBtn);

      // Verify roaming details
      expect(screen.getByText(/Review Notice:/i)).toBeInTheDocument();
      expect(screen.getByText(/1 Roaming/i)).toBeInTheDocument();
      expect(screen.getByText('⚠️ Roaming')).toBeInTheDocument();
      expect(screen.getByText('Branch North')).toBeInTheDocument();
    });

    it('displays empty state in modal for employee with no punches', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Charlie Absent')).toBeInTheDocument();
      });

      const viewCharlieBtn = screen.getByTitle(/Inspect punch details for Charlie Absent/i);
      await user.click(viewCharlieBtn);

      expect(screen.getByText(/No punches recorded today/i)).toBeInTheDocument();
    });
  });

  describe('Date Navigation and Refresh', () => {
    it('allows changing date via date input and refetches data for selected date', async () => {
      mockGetTeamSummary.mockResolvedValue(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(1);
      });

      const dateInput = screen.getByLabelText(/Select attendance date/i);
      fireEvent.change(dateInput, { target: { value: '2026-11-10' } });

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledWith({
          date: '2026-11-10',
          limit: 100,
          offset: 0,
        });
      });
    });

    it('allows quick date selection with Yesterday button', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValue(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(1);
      });

      const yesterdayBtn = screen.getByRole('button', { name: /^Yesterday$/i });
      await user.click(yesterdayBtn);

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(2);
      });
    });

    it('triggers manual refresh when clicking Refresh button', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValue(mockTeamAttendanceData);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(1);
      });

      const refreshBtn = screen.getByLabelText(/Refresh team attendance/i);
      await user.click(refreshBtn);

      await waitFor(() => {
        expect(mockGetTeamSummary).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Error Handling and Stale Closure Protection', () => {
    it('renders error banner with Retry button when API fails', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockRejectedValueOnce(
        new ApiError(500, 'Failed to connect to team attendance service')
      );

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText('Failed to connect to team attendance service')
        ).toBeInTheDocument();
      });

      // Retry
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);
      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      await user.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });
    });

    it('discards late responses from stale session epochs', async () => {
      let resolveFirstPromise: (value: DailyAttendanceOperationsResponse) => void;
      let callCount = 0;
      mockGetTeamSummary.mockImplementation(
        () =>
          new Promise((resolve) => {
            callCount++;
            if (callCount === 1) {
              resolveFirstPromise = resolve;
            }
          })
      );

      const { rerender } = render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      // Increment sessionEpoch to simulate sign-out / new session
      act(() => {
        rerender(
          <ManagerTeamAttendanceView
            currentUser={mockManagerUser}
            sessionEpoch={2}
          />
        );
      });

      // Now resolve the epoch 1 promise (which has arrived late)
      await act(async () => {
        resolveFirstPromise!(mockTeamAttendanceData);
      });

      // Old epoch 1 data should NOT leak into current state
      expect(screen.queryByText('Alice InTeam')).not.toBeInTheDocument();
    });
  });

  describe('Attendance Exception Review Workflow (GOV-08)', () => {
    it('allows manager to acknowledge roaming exception with optional notes and idempotency key', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);
      mockGetTeamSummary.mockResolvedValueOnce({
        ...mockTeamAttendanceData,
        employees: [
          mockTeamAttendanceData.employees[0],
          {
            ...mockTeamAttendanceData.employees[1],
            review_status: 'ACKNOWLEDGED',
            latest_review: {
              id: 501,
              employee_id: 102,
              attendance_date: '2026-11-15',
              reviewed_by_user_id: 2,
              reviewer_name: 'Bob Manager',
              reviewer_email: 'bob.manager@example.com',
              review_status: 'ACKNOWLEDGED',
              review_notes: 'Authorized client site meeting at North Branch',
              idempotency_key: 'test-idemp-001',
              created_at: '2026-11-15T18:00:00Z',
            },
          },
          mockTeamAttendanceData.employees[2],
        ],
      });
      mockAcknowledgeException.mockResolvedValueOnce({
        id: 501,
        employee_id: 102,
        attendance_date: '2026-11-15',
        reviewed_by_user_id: 2,
        reviewer_name: 'Bob Manager',
        reviewer_email: 'bob.manager@example.com',
        review_status: 'ACKNOWLEDGED',
        review_notes: 'Authorized client site meeting at North Branch',
        idempotency_key: 'test-idemp-001',
        created_at: '2026-11-15T18:00:00Z',
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      });

      // Open Bob's modal
      const viewBobBtn = screen.getByTitle(/Inspect punch details for Bob CurrentlyIn/i);
      await user.click(viewBobBtn);

      // Verify exception panel is displayed with warning
      expect(screen.getByText(/Attendance Exception Review \(GOV-08\)/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Requires Review/i).length).toBeGreaterThan(0);

      // Enter review notes
      const notesInput = screen.getByLabelText(/Supervisor Review Notes/i);
      await user.type(notesInput, 'Authorized client site meeting at North Branch');

      // Click acknowledge exception
      const ackBtn = screen.getByRole('button', { name: /Acknowledge Exception/i });
      await user.click(ackBtn);

      // Verify API was called with exact contract
      await waitFor(() => {
        expect(mockAcknowledgeException).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgeException).toHaveBeenCalledWith(
          expect.objectContaining({
            employee_id: 102,
            attendance_date: '2026-11-15',
            review_status: 'ACKNOWLEDGED',
            review_notes: 'Authorized client site meeting at North Branch',
            idempotency_key: expect.any(String),
          })
        );
      });

      // Verify success state and updated acknowledged box in place
      expect(await screen.findByText('Exception Acknowledged')).toBeInTheDocument();
      expect(screen.getAllByText('✓ Acknowledged').length).toBeGreaterThan(0);
    });

    it('disables submit button and shows loading state during active submission', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValue(mockTeamAttendanceData);

      let resolveAckPromise: (val: any) => void;
      mockAcknowledgeException.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAckPromise = resolve;
          })
      );

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      });

      const viewBobBtn = screen.getByTitle(/Inspect punch details for Bob CurrentlyIn/i);
      await user.click(viewBobBtn);

      const ackBtn = screen.getByRole('button', { name: /Acknowledge Exception/i });
      await user.click(ackBtn);

      // Verify button disabled during submission
      expect(ackBtn).toBeDisabled();
      expect(screen.getByText(/Acknowledging.../i)).toBeInTheDocument();

      // Resolve submission
      await act(async () => {
        resolveAckPromise({
          id: 502,
          employee_id: 102,
          attendance_date: '2026-11-15',
          reviewed_by_user_id: 2,
          reviewer_name: 'Bob Manager',
          reviewer_email: 'bob.manager@example.com',
          review_status: 'ACKNOWLEDGED',
          review_notes: null,
          idempotency_key: 'test-idemp-002',
          created_at: '2026-11-15T18:00:00Z',
        });
      });

      expect(screen.getByText(/Attendance exception successfully acknowledged/i)).toBeInTheDocument();
    });

    it('preserves idempotency key across retry on network failure', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValue(mockTeamAttendanceData);

      // First call fails with 500
      mockAcknowledgeException.mockRejectedValueOnce(
        new ApiError(500, 'Network timeout while recording review')
      );
      // Second call succeeds
      mockAcknowledgeException.mockResolvedValueOnce({
        id: 503,
        employee_id: 102,
        attendance_date: '2026-11-15',
        reviewed_by_user_id: 2,
        reviewer_name: 'Bob Manager',
        reviewer_email: 'bob.manager@example.com',
        review_status: 'ACKNOWLEDGED',
        review_notes: null,
        idempotency_key: 'test-retry-idemp',
        created_at: '2026-11-15T18:05:00Z',
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      });

      const viewBobBtn = screen.getByTitle(/Inspect punch details for Bob CurrentlyIn/i);
      await user.click(viewBobBtn);

      const ackBtn = screen.getByRole('button', { name: /Acknowledge Exception/i });
      await user.click(ackBtn);

      // Verify error banner
      await waitFor(() => {
        expect(screen.getByText(/Network timeout while recording review/i)).toBeInTheDocument();
      });

      // Click Retry
      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      await user.click(retryBtn);

      // Verify two calls made with the exact same idempotency key
      expect(mockAcknowledgeException).toHaveBeenCalledTimes(2);
      const firstCallKey = mockAcknowledgeException.mock.calls[0][0].idempotency_key;
      const secondCallKey = mockAcknowledgeException.mock.calls[1][0].idempotency_key;
      expect(firstCallKey).toBe(secondCallKey);
      await waitFor(() => {
        expect(screen.getByText(/Attendance exception successfully acknowledged/i)).toBeInTheDocument();
      });
    });

    it('fetches and displays review history timeline when clicking View Review History', async () => {
      const user = userEvent.setup();
      const acknowledgedData: DailyAttendanceOperationsResponse = {
        ...mockTeamAttendanceData,
        employees: [
          mockTeamAttendanceData.employees[0],
          {
            ...mockTeamAttendanceData.employees[1],
            review_status: 'ACKNOWLEDGED',
            latest_review: {
              id: 901,
              employee_id: 102,
              attendance_date: '2026-11-15',
              reviewed_by_user_id: 2,
              reviewer_name: 'Supervisor Sarah',
              reviewer_email: 'sarah.sup@example.com',
              review_status: 'ACKNOWLEDGED',
              review_notes: 'Prior morning note',
              idempotency_key: 'hist-key-01',
              created_at: '2026-11-15T10:00:00Z',
            },
          },
          mockTeamAttendanceData.employees[2],
        ],
      };
      mockGetTeamSummary.mockResolvedValue(acknowledgedData);
      mockGetAttendanceReviews.mockResolvedValueOnce({
        employee_id: 102,
        total_items: 2,
        items: [
          {
            id: 902,
            employee_id: 102,
            attendance_date: '2026-11-15',
            reviewed_by_user_id: 2,
            reviewer_name: 'Supervisor Sarah',
            reviewer_email: 'sarah.sup@example.com',
            review_status: 'ACKNOWLEDGED',
            review_notes: 'Updated evening approval note',
            idempotency_key: 'hist-key-02',
            created_at: '2026-11-15T17:00:00Z',
          },
          {
            id: 901,
            employee_id: 102,
            attendance_date: '2026-11-15',
            reviewed_by_user_id: 2,
            reviewer_name: 'Supervisor Sarah',
            reviewer_email: 'sarah.sup@example.com',
            review_status: 'ACKNOWLEDGED',
            review_notes: 'Prior morning note',
            idempotency_key: 'hist-key-01',
            created_at: '2026-11-15T10:00:00Z',
          },
        ],
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob CurrentlyIn')).toBeInTheDocument();
      });

      const viewBobBtn = screen.getByTitle(/Inspect punch details for Bob CurrentlyIn/i);
      await user.click(viewBobBtn);

      // Verify acknowledged state box
      expect(screen.getByText(/Exception Acknowledged/i)).toBeInTheDocument();
      expect(screen.getByText(/Supervisor Sarah/i)).toBeInTheDocument();

      // Click View Review History
      const historyToggleBtn = screen.getByRole('button', { name: /View Review History/i });
      await user.click(historyToggleBtn);

      await waitFor(() => {
        expect(mockGetAttendanceReviews).toHaveBeenCalledWith({
          employee_id: 102,
          attendance_date: '2026-11-15',
          limit: 20,
        });
      });

      // Verify past history items rendered
      expect(screen.getByText(/Audit Trail: Past Review Actions/i)).toBeInTheDocument();
      expect(screen.getByText(/"Updated evening approval note"/i)).toBeInTheDocument();
      expect(screen.getByText(/"Prior morning note"/i)).toBeInTheDocument();
    });
  });

  describe('Attendance Correction Requests Workflow & Anti-Self-Approval', () => {
    const mockCorrectionsData = [
      {
        id: 501,
        employee_id: 101, // Alice InTeam
        employee_name: 'Alice InTeam',
        employee_code: 'EMP-001',
        department: 'Engineering',
        attendance_date: '2026-11-15',
        correction_type: 'MISSING_CHECK_OUT' as const,
        proposed_timestamp: '2026-11-15T18:00:00Z',
        original_event_id: null,
        reason: 'Device turnstile failed to register check-out',
        status: 'PENDING' as const,
        requested_by_user_id: 10, // Not mockManagerUser (id: 3)
        requester_name: 'Alice InTeam',
        requester_email: 'alice@example.com',
        reviewed_by_user_id: null,
        reviewer_name: null,
        reviewer_email: null,
        review_notes: null,
        reviewed_at: null,
        idempotency_key: 'corr-501',
        created_at: '2026-11-15T18:30:00Z',
        updated_at: '2026-11-15T18:30:00Z',
      },
      {
        id: 502,
        employee_id: 2, // Matches mockManagerUser.employee_id (id: 2) -> Self request!
        employee_name: 'Bob Manager',
        employee_code: 'MGR-001',
        department: 'Engineering',
        attendance_date: '2026-11-15',
        correction_type: 'MISSING_CHECK_IN' as const,
        proposed_timestamp: '2026-11-15T09:00:00Z',
        original_event_id: null,
        reason: 'Badge forgotten in car, check-in punch missed',
        status: 'PENDING' as const,
        requested_by_user_id: 3, // Matches mockManagerUser.id (id: 3) -> Self request!
        requester_name: 'Bob Manager',
        requester_email: 'manager@mbiotrack.local',
        reviewed_by_user_id: null,
        reviewer_name: null,
        reviewer_email: null,
        review_notes: null,
        reviewed_at: null,
        idempotency_key: 'corr-502',
        created_at: '2026-11-15T19:00:00Z',
        updated_at: '2026-11-15T19:00:00Z',
      },
    ];

    it('switches between Team Daily Attendance and Correction Requests tabs', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);
      mockGetCorrections.mockResolvedValueOnce({
        items: mockCorrectionsData,
        total: 2,
        limit: 50,
        offset: 0,
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      // Tab button should have pending count badge
      const correctionsTabBtn = screen.getByRole('button', { name: /Correction Requests/i });
      expect(correctionsTabBtn).toBeInTheDocument();

      await user.click(correctionsTabBtn);

      // Verify Correction Requests table is visible
      expect(screen.getByLabelText('Attendance Correction Requests Table')).toBeInTheDocument();
      expect(screen.getByText('Device turnstile failed to register check-out')).toBeInTheDocument();
    });

    it('enforces anti-self-approval rule by disabling approval on own requests', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);
      mockGetCorrections.mockResolvedValueOnce({
        items: mockCorrectionsData,
        total: 2,
        limit: 50,
        offset: 0,
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser} // id: 3, employee_id: 2
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Correction Requests/i }));

      // Alice's request (other employee): Approve and Reject buttons available
      expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();

      // Bob's request (self request): Anti-self-approval protection prohibits review
      expect(screen.getByText(/Self-Request \(Review Prohibited\)/i)).toBeInTheDocument();
    });

    it('allows manager to approve another employee correction request with optional notes', async () => {
      const user = userEvent.setup();
      mockGetTeamSummary.mockResolvedValueOnce(mockTeamAttendanceData);
      mockGetCorrections.mockResolvedValueOnce({
        items: mockCorrectionsData,
        total: 2,
        limit: 50,
        offset: 0,
      });
      mockReviewCorrection.mockResolvedValueOnce({
        ...mockCorrectionsData[0],
        status: 'APPROVED',
        reviewer_name: 'Bob Manager',
        review_notes: 'Approved based on turnstile CCTV logs',
      });

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Correction Requests/i }));

      const approveBtn = screen.getByRole('button', { name: /^Approve$/i });
      await user.click(approveBtn);

      // Modal appears
      expect(screen.getByRole('heading', { name: /Approve Attendance Correction/i })).toBeInTheDocument();
      expect(screen.getAllByText(/Device turnstile failed to register check-out/i).length).toBeGreaterThan(0);

      const notesInput = screen.getByLabelText(/Supervisor Review Notes/i);
      await user.type(notesInput, 'Approved based on turnstile CCTV logs');

      const confirmBtn = screen.getByRole('button', { name: /Confirm Approval/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockReviewCorrection).toHaveBeenCalledWith(501, {
          status: 'APPROVED',
          review_notes: 'Approved based on turnstile CCTV logs',
        });
      });
    });

    it('displays missing-punch review reason in team view when review_status is REQUIRES_REVIEW', async () => {
      const teamDataWithMissingPunch: DailyAttendanceOperationsResponse = {
        ...mockTeamAttendanceData,
        employees: [
          {
            ...mockTeamAttendanceData.employees[0],
            review_status: 'REQUIRES_REVIEW',
            review_reason: 'Incomplete attendance: Missing CHECK_OUT',
          },
        ],
      };
      mockGetTeamSummary.mockResolvedValueOnce(teamDataWithMissingPunch);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      // Verify the missing punch reason badge is shown
      expect(screen.getByText(/⚠️ Incomplete attendance: Missing CHECK_OUT/i)).toBeInTheDocument();
    });

    it('renders corrected punch indicator when punch.is_corrected is true', async () => {
      const teamDataWithCorrectedPunch: DailyAttendanceOperationsResponse = {
        ...mockTeamAttendanceData,
        employees: [
          {
            ...mockTeamAttendanceData.employees[0],
            punches: [
              {
                ...mockTeamAttendanceData.employees[0].punches[0],
                is_corrected: true,
                correction_id: 501,
              },
            ],
          },
        ],
      };
      mockGetTeamSummary.mockResolvedValueOnce(teamDataWithCorrectedPunch);

      render(
        <ManagerTeamAttendanceView
          currentUser={mockManagerUser}
          sessionEpoch={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice InTeam')).toBeInTheDocument();
      });

      // Main table should have corrected indicator
      expect(screen.getAllByTitle('Corrected punch').length).toBeGreaterThan(0);

      // Open detail modal and verify Corrected badge
      const viewBtn = screen.getByTitle(/Inspect punch details for Alice InTeam/i);
      await userEvent.click(viewBtn);

      expect(screen.getByText('Corrected')).toBeInTheDocument();
    });
  });
});
