import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as employeeApi from '../api/employeeApi';
import * as holidayApi from '../api/holidayApi';
import * as leaveApi from '../api/leaveApi';
import * as officeApi from '../api/officeApi';
import { mockAdminUser, mockEmployeeUser } from '../test/fixtures/authFixtures';
import type {
  EmployeeLeaveEntitlement,
  LeaveEntitlementDefault,
  LeaveRequestDetail,
} from '../types/leave';
import type { Employee } from '../types/employee';
import { LeaveAndHolidayView } from './LeaveAndHolidayView';

describe('Leave Entitlements & Balances UI', () => {
  const sampleEmployees: Employee[] = [
    {
      id: 1,
      employee_code: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      department: 'Engineering',
      designation: 'Software Engineer',
      joining_date: '2025-01-01',
      is_active: true,
    },
  ];

  const sampleDefaults: LeaveEntitlementDefault[] = [
    {
      id: 1,
      year: 2026,
      leave_type: 'ANNUAL',
      allocated_days: 15,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleOverrides: EmployeeLeaveEntitlement[] = [
    {
      id: 10,
      employee_id: 1,
      employee_code: 'EMP-001',
      employee_name: 'Alice Smith',
      department: 'Engineering',
      year: 2026,
      leave_type: 'ANNUAL',
      allocated_days: 20,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleLeaveWithBalance: LeaveRequestDetail = {
    id: 99,
    employee_id: 42,
    employee_name: 'Alice Smith',
    employee_code: 'EMP-042',
    department: 'Engineering',
    start_date: '2026-06-01',
    end_date: '2026-06-03',
    leave_type: 'ANNUAL',
    reason: 'Vacation trip',
    status: 'PENDING',
    working_days: 3,
    allocated_days: 20,
    available_days_before: 20,
    available_days_after: 17,
    decision_by_user_id: null,
    decision_by_user_name: null,
    decision_notes: null,
    decided_at: null,
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(officeApi, 'getOffices').mockResolvedValue([]);
    vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(employeeApi, 'getEmployees').mockResolvedValue(sampleEmployees);
    vi.spyOn(leaveApi, 'getLeaveRequests').mockResolvedValue({
      items: [sampleLeaveWithBalance],
      total: 1,
      limit: 20,
      offset: 0,
      department: null,
    });
    vi.spyOn(leaveApi, 'getLeaveRequest').mockResolvedValue(sampleLeaveWithBalance);
    vi.spyOn(leaveApi, 'getEntitlementDefaults').mockResolvedValue(sampleDefaults);
    vi.spyOn(leaveApi, 'getEntitlementOverrides').mockResolvedValue(sampleOverrides);
    vi.spyOn(leaveApi, 'setEntitlementDefault').mockResolvedValue({
      id: 2,
      year: 2026,
      leave_type: 'SICK',
      allocated_days: 10,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    vi.spyOn(leaveApi, 'deleteEntitlementDefault').mockResolvedValue(undefined);
    vi.spyOn(leaveApi, 'setEntitlementOverride').mockResolvedValue({
      id: 11,
      employee_id: 1,
      year: 2026,
      leave_type: 'SICK',
      allocated_days: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    vi.spyOn(leaveApi, 'deleteEntitlementOverride').mockResolvedValue(undefined);
  });

  it('shows Leave Entitlements subtab for ADMIN but hides it for EMPLOYEE', async () => {
    const { unmount } = render(
      <LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('tab-leave-entitlements')).toBeInTheDocument();
    });

    unmount();

    render(
      <LeaveAndHolidayView currentUser={mockEmployeeUser} sessionEpoch={1} />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('tab-leave-entitlements')).not.toBeInTheDocument();
    });
  });

  it('renders Organization Defaults and Employee Overrides tables when navigating to Entitlements tab', async () => {
    render(
      <LeaveAndHolidayView
        currentUser={mockAdminUser}
        sessionEpoch={1}
        initialSubTab="entitlements"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('leave-entitlements-section')).toBeInTheDocument();
    });

    // Check defaults table
    expect(screen.getByTestId('org-defaults-table')).toBeInTheDocument();
    expect(screen.getByText('15 days')).toBeInTheDocument();

    // Check overrides table
    expect(screen.getByTestId('employee-overrides-table')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('20 days')).toBeInTheDocument();
  });

  it('allows Admin to configure an organization default quota', async () => {
    const user = userEvent.setup();
    render(
      <LeaveAndHolidayView
        currentUser={mockAdminUser}
        sessionEpoch={1}
        initialSubTab="entitlements"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('configure-default-sick')).toBeInTheDocument();
    });

    // Click Configure Quota on SICK leave
    await user.click(screen.getByTestId('configure-default-sick'));

    await waitFor(() => {
      expect(screen.getByTestId('entitlement-days-input')).toBeInTheDocument();
    });

    // Clear and enter 12
    const input = screen.getByTestId('entitlement-days-input');
    await user.clear(input);
    await user.type(input, '12');

    // Click Save
    await user.click(screen.getByTestId('save-entitlement-btn'));

    await waitFor(() => {
      expect(leaveApi.setEntitlementDefault).toHaveBeenCalledWith(
        expect.objectContaining({
          leave_type: 'SICK',
          allocated_days: 12,
        })
      );
    });
  });

  it('displays balance impact in leave review modal', async () => {
    const user = userEvent.setup();
    render(
      <LeaveAndHolidayView
        currentUser={mockAdminUser}
        sessionEpoch={1}
        initialSubTab="leaves"
      />
    );

    // Find and click the Approve button on the pending leave
    await waitFor(() => {
      expect(screen.getByTestId('approve-leave-btn-99')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('approve-leave-btn-99'));

    await waitFor(() => {
      expect(screen.getByTestId('review-balance-impact')).toBeInTheDocument();
    });

    // Verify balance impact details
    expect(screen.getByText('Annual Quota')).toBeInTheDocument();
    expect(screen.getAllByText('20d')).toHaveLength(2); // Quota and Available Before
    expect(screen.getByText('Available Before')).toBeInTheDocument();
    expect(screen.getByText('Available After')).toBeInTheDocument();
    expect(screen.getByText('17d')).toBeInTheDocument();
  });
});
