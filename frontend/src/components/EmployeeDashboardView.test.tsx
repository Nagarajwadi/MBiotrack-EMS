import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeDashboardView } from './EmployeeDashboardView';
import * as attendanceApi from '../api/attendanceApi';
import * as deviceApi from '../api/deviceApi';
import * as leaveApi from '../api/leaveApi';
import { mockEmployeeUser } from '../test/fixtures/authFixtures';
import type {
  AttendanceListResponse,
  DailyAttendanceOperationsResponse,
} from '../types/attendance';
import type { LeaveRequestListResponse } from '../types/leave';

vi.mock('../api/attendanceApi', () => ({
  getDailyAttendanceOperations: vi.fn(),
  getAttendanceRecords: vi.fn(),
  recordAttendancePunch: vi.fn(),
}));

vi.mock('../api/deviceApi', () => ({
  getDevices: vi.fn(),
}));

vi.mock('../api/leaveApi', () => ({
  getLeaveRequests: vi.fn(),
}));

const mockDailyRecord: DailyAttendanceOperationsResponse = {
  summary: {
    date: '2026-11-08',
    total_events: 2,
    employees_with_punches: 1,
    employees_without_punches: 0,
    requires_review_count: 0,
    roaming_punch_count: 0,
    eligible_employee_count: 1,
  },
  employees: [
    {
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      assigned_office_id: 1,
      assigned_office_name: 'HQ Bengaluru',
      assigned_office_code: 'BLR-HQ',
      punch_count: 2,
      first_punch: '2026-11-08T09:00:00Z',
      last_punch: '2026-11-08T17:30:00Z',
      has_roaming: false,
      roaming_count: 0,
      review_status: 'NORMAL',
      review_reason: null,
      punches: [
        {
          id: 101,
          punch_type: 'CHECK_IN',
          event_timestamp: '2026-11-08T09:00:00Z',
          device_id: 10,
          device_name: 'Main Turnstile',
          device_code: 'TERM-01',
          office_id: 1,
          office_name: 'HQ Bengaluru',
          office_code: 'BLR-HQ',
          is_roaming: false,
        },
        {
          id: 102,
          punch_type: 'CHECK_OUT',
          event_timestamp: '2026-11-08T17:30:00Z',
          device_id: 10,
          device_name: 'Main Turnstile',
          device_code: 'TERM-01',
          office_id: 1,
          office_name: 'HQ Bengaluru',
          office_code: 'BLR-HQ',
          is_roaming: false,
        },
      ],
    },
  ],
  total_employees: 1,
  limit: 50,
  offset: 0,
};

const mockRecentEvents: AttendanceListResponse = {
  items: [
    {
      id: 102,
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      device_id: 10,
      device_name: 'Main Turnstile',
      device_code: 'TERM-01',
      office_id: 1,
      office_name: 'HQ Bengaluru',
      office_code: 'BLR-HQ',
      punch_type: 'CHECK_OUT',
      event_timestamp: '2026-11-08T17:30:00Z',
      is_roaming: false,
      idempotency_key: null,
      actor_user_id: 3,
      created_at: '2026-11-08T17:30:00Z',
    },
    {
      id: 101,
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      device_id: 10,
      device_name: 'Main Turnstile',
      device_code: 'TERM-01',
      office_id: 1,
      office_name: 'HQ Bengaluru',
      office_code: 'BLR-HQ',
      punch_type: 'CHECK_IN',
      event_timestamp: '2026-11-08T09:00:00Z',
      is_roaming: false,
      idempotency_key: null,
      actor_user_id: 3,
      created_at: '2026-11-08T09:00:00Z',
    },
  ],
  total: 2,
  limit: 5,
  offset: 0,
};

const mockLeavesResponse: LeaveRequestListResponse = {
  items: [
    {
      id: 201,
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      start_date: '2026-11-15',
      end_date: '2026-11-16',
      leave_type: 'ANNUAL',
      reason: 'Family trip',
      status: 'PENDING',
      decision_by_user_id: null,
      decision_by_user_name: null,
      decision_notes: null,
      decided_at: null,
      created_at: '2026-11-05T10:00:00Z',
      updated_at: '2026-11-05T10:00:00Z',
    },
    {
      id: 202,
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      start_date: '2026-08-10',
      end_date: '2026-08-12',
      leave_type: 'ANNUAL',
      reason: 'Summer break',
      status: 'APPROVED',
      decision_by_user_id: 1,
      decision_by_user_name: 'Admin',
      decision_notes: 'Approved',
      decided_at: '2026-08-01T10:00:00Z',
      created_at: '2026-08-01T10:00:00Z',
      updated_at: '2026-08-01T10:00:00Z',
    },
    {
      id: 203,
      employee_id: 3,
      employee_code: 'EMP001',
      employee_name: 'Charlie Employee',
      department: 'Engineering',
      start_date: '2026-09-01',
      end_date: '2026-09-01',
      leave_type: 'SICK',
      reason: 'Fever',
      status: 'APPROVED',
      decision_by_user_id: 1,
      decision_by_user_name: 'Admin',
      decision_notes: 'Take care',
      decided_at: '2026-09-01T08:00:00Z',
      created_at: '2026-09-01T08:00:00Z',
      updated_at: '2026-09-01T08:00:00Z',
    },
  ],
  total: 3,
  limit: 50,
  offset: 0,
};

describe('EmployeeDashboardView Component', () => {
  const mockNavigateToAttendance = vi.fn();
  const mockNavigateToLeaves = vi.fn();
  const mockNavigateToProfile = vi.fn();
  const mockNavigateToDirectory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attendanceApi.getDailyAttendanceOperations).mockResolvedValue(mockDailyRecord);
    vi.mocked(attendanceApi.getAttendanceRecords).mockResolvedValue(mockRecentEvents);
    vi.mocked(deviceApi.getDevices).mockResolvedValue([
      {
        id: 10,
        office_id: 1,
        name: 'Main Turnstile',
        device_code: 'TERM-01',
        serial_number: 'SN-01',
        model_name: 'BioEntry-W2',
        ip_address: null,
        mac_address: null,
        status: 'ACTIVE',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    vi.mocked(leaveApi.getLeaveRequests).mockResolvedValue(mockLeavesResponse);
  });

  it('renders loading progressbar while fetching dashboard data', () => {
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    expect(screen.getByRole('progressbar', { name: /loading dashboard data/i })).toBeInTheDocument();
  });

  it('renders welcome banner and today attendance status with first/last punch', async () => {
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    expect(
      await screen.findByRole('heading', { name: new RegExp(`welcome back, ${mockEmployeeUser.full_name}`, 'i') })
    ).toBeInTheDocument();

    const attendanceCard = screen.getByTestId('dashboard-today-attendance');
    expect(attendanceCard).toBeInTheDocument();
    expect(attendanceCard).toHaveTextContent(/checked out/i);
    expect(attendanceCard).toHaveTextContent('First Check-In');
    expect(attendanceCard).toHaveTextContent('Last Check-Out');
    expect(attendanceCard).toHaveTextContent('Total Punches');
    expect(attendanceCard).toHaveTextContent('2');

    // Contextual button recommends Check In since last punch was CHECK_OUT
    expect(screen.getByRole('button', { name: /🟢 check in/i })).toBeInTheDocument();
  });

  it('calculates and renders leave usage summary without assuming unauthoritative quotas', async () => {
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    const leaveCard = await screen.findByTestId('dashboard-leave-balance');
    expect(leaveCard).toBeInTheDocument();
    expect(leaveCard).toHaveTextContent('Leave Usage Summary');

    // Assumed quotas and artificial denominators must NOT be present
    expect(leaveCard).not.toHaveTextContent(/quota/i);
    expect(leaveCard).not.toHaveTextContent('/ 18');
    expect(leaveCard).not.toHaveTextContent('/ 12');
    expect(leaveCard).not.toHaveTextContent('/ 10');
    expect(leaveCard).not.toHaveTextContent(/available/i);

    // Actual approved days and pending in-review days from employee data
    expect(leaveCard).toHaveTextContent('Annual Leave');
    expect(leaveCard).toHaveTextContent('3 days approved');
    expect(leaveCard).toHaveTextContent('Pending: 2d');

    expect(leaveCard).toHaveTextContent('Sick Leave');
    expect(leaveCard).toHaveTextContent('1 day approved');
    expect(leaveCard).toHaveTextContent('0d pending');

    expect(leaveCard).toHaveTextContent('Casual Leave');
    expect(leaveCard).toHaveTextContent('0 days approved');
    expect(leaveCard).toHaveTextContent('0d pending');
  });

  it('renders recent attendance punches table', async () => {
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    const recentCard = await screen.findByTestId('dashboard-recent-punches');
    expect(recentCard).toBeInTheDocument();
    expect(screen.getAllByText('HQ Bengaluru').length).toBe(2);
    expect(screen.getByText('CHECK OUT')).toBeInTheDocument();
    expect(screen.getByText('CHECK IN')).toBeInTheDocument();
  });

  it('renders pending leave requests table', async () => {
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    const pendingCard = await screen.findByTestId('dashboard-pending-leaves');
    expect(pendingCard).toBeInTheDocument();
    expect(screen.getByText(/2026-11-15 to 2026-11-16/i)).toBeInTheDocument();
    expect(screen.getByText('Family trip')).toBeInTheDocument();
    expect(screen.getByText('1 Pending')).toBeInTheDocument();
  });

  it('handles empty recent punches and empty pending leaves gracefully', async () => {
    vi.mocked(attendanceApi.getDailyAttendanceOperations).mockResolvedValueOnce({
      summary: mockDailyRecord.summary,
      employees: [],
      total_employees: 0,
      limit: 50,
      offset: 0,
    });
    vi.mocked(attendanceApi.getAttendanceRecords).mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    });
    vi.mocked(leaveApi.getLeaveRequests).mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    expect(await screen.findByTestId('empty-recent-punches')).toBeInTheDocument();
    expect(screen.getByTestId('empty-pending-leaves')).toBeInTheDocument();

    const attendanceCard = screen.getByTestId('dashboard-today-attendance');
    expect(attendanceCard).toHaveTextContent(/not checked in/i);
    expect(attendanceCard).toHaveTextContent('Total Punches0');
  });

  it('navigates to attendance, leaves, and profile when quick actions are clicked', async () => {
    const user = userEvent.setup();
    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
        onNavigateToDirectory={mockNavigateToDirectory}
      />
    );

    await screen.findByRole('heading', { name: new RegExp(`welcome back`, 'i') });

    // Click My Attendance in welcome banner
    await user.click(screen.getByRole('button', { name: /⏱️ my attendance/i }));
    expect(mockNavigateToAttendance).toHaveBeenCalledTimes(1);

    // Click Leaves & Holidays in welcome banner
    await user.click(screen.getByRole('button', { name: /🏖️ leaves & holidays/i }));
    expect(mockNavigateToLeaves).toHaveBeenCalledTimes(1);

    // Click View Profile in welcome banner
    await user.click(screen.getByRole('button', { name: /👤 view profile/i }));
    expect(mockNavigateToProfile).toHaveBeenCalledTimes(1);

    // Click Employee Directory in welcome banner
    await user.click(screen.getByRole('button', { name: /👥 employee directory/i }));
    expect(mockNavigateToDirectory).toHaveBeenCalledTimes(1);
  });

  it('displays error state and allows retry when API calls fail', async () => {
    const user = userEvent.setup();
    vi.mocked(attendanceApi.getDailyAttendanceOperations).mockRejectedValueOnce(
      new Error('Network connectivity lost')
    );

    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/network connectivity lost/i);

    // Click Retry
    vi.mocked(attendanceApi.getDailyAttendanceOperations).mockResolvedValueOnce(mockDailyRecord);
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(
      await screen.findByRole('heading', { name: new RegExp(`welcome back`, 'i') })
    ).toBeInTheDocument();
  });

  it('opens PunchModal when punch button is clicked and displays success feedback', async () => {
    const user = userEvent.setup();
    vi.mocked(attendanceApi.recordAttendancePunch).mockResolvedValueOnce({
      id: 999,
      employee_id: 3,
      device_id: 10,
      office_id: 1,
      punch_type: 'CHECK_IN',
      event_timestamp: '2026-11-08T09:15:00Z',
      is_roaming: false,
      idempotency_key: 'test-uuid-1',
      actor_user_id: 3,
      created_at: '2026-11-08T09:15:00Z',
      notes: null,
    });

    render(
      <EmployeeDashboardView
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
        onNavigateToAttendance={mockNavigateToAttendance}
        onNavigateToLeaves={mockNavigateToLeaves}
        onNavigateToProfile={mockNavigateToProfile}
      />
    );

    await screen.findByRole('heading', { name: new RegExp(`welcome back`, 'i') });

    const punchBtn = screen.getByTestId('dashboard-punch-btn');
    await user.click(punchBtn);

    // Modal dialog opens
    expect(await screen.findByRole('dialog', { name: /confirmation/i })).toBeInTheDocument();

    // Submit punch modal
    const confirmBtn = screen.getByRole('button', { name: /confirm check in/i });
    await user.click(confirmBtn);

    // Modal closes and success feedback is displayed
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/check in successfully recorded/i);
    });
  });
});
