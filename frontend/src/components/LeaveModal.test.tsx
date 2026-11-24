import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as assignmentApi from '../api/assignmentApi';
import * as holidayApi from '../api/holidayApi';
import * as officeApi from '../api/officeApi';
import * as leaveApi from '../api/leaveApi';
import { ApiError } from '../api/apiError';
import { LeaveModal } from './LeaveModal';
import type { User } from '../types/auth';
import type { HolidayDetail } from '../types/holiday';
import type { OfficeAssignment } from '../types/assignment';
import type { Office } from '../types/office';
import type { EmployeeLeaveBalanceSummary } from '../types/leave';

describe('LeaveModal Component', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const mockEmployeeUser: User = {
    id: 1,
    employee_id: 1,
    full_name: 'John Doe',
    email: 'john@example.com',
    role: 'EMPLOYEE',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mockAdminUser: User = {
    id: 99,
    employee_id: 99,
    full_name: 'Admin User',
    email: 'admin@example.com',
    role: 'ADMIN',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const sampleOffices: Office[] = [
    {
      id: 1,
      name: 'Test Office',
      code: 'TEST-01',
      timezone: 'Asia/Kolkata',
      address: 'Tech Park',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      name: 'Other Office',
      code: 'OTHER-02',
      timezone: 'Asia/Kolkata',
      address: 'City Center',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleAssignments: OfficeAssignment[] = [
    {
      id: 10,
      employee_id: 1,
      office_id: 1,
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: '2027-01-01T00:00:00Z',
      is_primary: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleHolidays: HolidayDetail[] = [
    {
      id: 101,
      holiday_date: '2026-12-04',
      name: 'Test Optional Holiday',
      description: 'Office 1 optional holiday',
      office_id: 1,
      office_name: 'Test Office',
      office_code: 'TEST-01',
      is_optional: true,
      created_by_user_id: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 102,
      holiday_date: '2026-12-05',
      name: 'Global Optional Day',
      description: 'Org-wide optional holiday',
      office_id: null,
      office_name: null,
      office_code: null,
      is_optional: true,
      created_by_user_id: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 103,
      holiday_date: '2026-12-04',
      name: 'Other Office Holiday',
      description: 'Office 2 optional holiday',
      office_id: 2,
      office_name: 'Other Office',
      office_code: 'OTHER-02',
      is_optional: true,
      created_by_user_id: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(officeApi, 'getOffices').mockResolvedValue(sampleOffices);
    vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue(sampleAssignments);
    vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({
      items: sampleHolidays,
      total: sampleHolidays.length,
    });
  });

  describe('Live Working-Day Preview', () => {
    it('calculates 2 working days for Dec 4–7, 2026 without selecting optional holiday', async () => {
      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
          'Estimated Duration: 2 working days'
        );
      });
    });

    it('updates live preview to 1 working day when Dec 4 optional holiday is selected, and restores 2 working days on deselect', async () => {
      const user = userEvent.setup();

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
          'Estimated Duration: 2 working days'
        );
        expect(screen.getByTestId('optional-holiday-2026-12-04')).toBeInTheDocument();
      });

      const optCheckbox = screen.getByTestId('optional-holiday-2026-12-04');
      await user.click(optCheckbox);

      // Now Dec 4 is excluded -> exactly 1 working day (Monday Dec 7)
      expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
        'Estimated Duration: 1 working day'
      );

      // Deselecting restores 2 working days
      await user.click(optCheckbox);
      expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
        'Estimated Duration: 2 working days'
      );
    });

    it('displays warning when range contains zero working days', async () => {
      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Dec 5 (Saturday) to Dec 6 (Sunday)
      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-05' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-06' } });

      await waitFor(() => {
        expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
          'Estimated Duration: 0 working days'
        );
      });

      expect(screen.getByTestId('zero-working-days-warning')).toBeInTheDocument();
      expect(
        screen.getByText(/requested leave range contains zero working days/i)
      ).toBeInTheDocument();
    });

    it('safely handles reversed date ranges without crashing', async () => {
      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-07' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-04' } });

      // Reversed range should not show a preview
      expect(screen.queryByTestId('working-days-preview')).not.toBeInTheDocument();
    });
  });

  describe('Date-Specific Office Assignment Filtering', () => {
    it('does not expose an office holiday when the employee assignment has expired before the holiday date', async () => {
      // Assignment expired on 2026-11-30
      vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue([
        {
          id: 10,
          employee_id: 1,
          office_id: 1,
          valid_from: '2026-01-01T00:00:00Z',
          valid_to: '2026-11-30T23:59:59Z',
          is_primary: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]);

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        // Org-wide holiday is exposed
        expect(screen.getByTestId('optional-holiday-2026-12-05')).toBeInTheDocument();
      });

      // Expired Office 1 holiday on Dec 4 must NOT be exposed
      expect(screen.queryByTestId('optional-holiday-2026-12-04')).not.toBeInTheDocument();
      expect(screen.queryByText(/test optional holiday/i)).not.toBeInTheDocument();
    });

    it('does not expose an office holiday before a future assignment effective date', async () => {
      // Assignment starts on 2026-12-10
      vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue([
        {
          id: 10,
          employee_id: 1,
          office_id: 1,
          valid_from: '2026-12-10T00:00:00Z',
          valid_to: '2027-12-31T23:59:59Z',
          is_primary: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]);

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-05')).toBeInTheDocument();
      });

      // Future assignment office holiday on Dec 4 must NOT be exposed
      expect(screen.queryByTestId('optional-holiday-2026-12-04')).not.toBeInTheDocument();
    });

    it('correctly scopes holidays when an employee transfers offices mid-period', async () => {
      // Employee in Office 1 through Dec 5, then Office 2 starting Dec 5
      vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue([
        {
          id: 10,
          employee_id: 1,
          office_id: 1,
          valid_from: '2026-01-01T00:00:00Z',
          valid_to: '2026-12-05T00:00:00Z',
          is_primary: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 11,
          employee_id: 1,
          office_id: 2,
          valid_from: '2026-12-05T00:00:00Z',
          valid_to: '2027-01-01T00:00:00Z',
          is_primary: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]);

      vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({
        items: [
          {
            id: 201,
            holiday_date: '2026-12-04',
            name: 'Office 1 Dec 4 Holiday',
            description: null,
            office_id: 1,
            office_name: 'Test Office',
            office_code: 'TEST-01',
            is_optional: true,
            created_by_user_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 202,
            holiday_date: '2026-12-07',
            name: 'Office 2 Dec 7 Holiday',
            description: null,
            office_id: 2,
            office_name: 'Other Office',
            office_code: 'OTHER-02',
            is_optional: true,
            created_by_user_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 203,
            holiday_date: '2026-12-07',
            name: 'Office 1 Dec 7 Holiday',
            description: null,
            office_id: 1,
            office_name: 'Test Office',
            office_code: 'TEST-01',
            is_optional: true,
            created_by_user_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 204,
            holiday_date: '2026-12-04',
            name: 'Office 2 Dec 4 Holiday',
            description: null,
            office_id: 2,
            office_name: 'Other Office',
            office_code: 'OTHER-02',
            is_optional: true,
            created_by_user_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 4,
      });

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        // Dec 4: Employee is at Office 1 -> Office 1 holiday is exposed
        expect(screen.getByText('Office 1 Dec 4 Holiday')).toBeInTheDocument();
        // Dec 7: Employee is at Office 2 -> Office 2 holiday is exposed
        expect(screen.getByText('Office 2 Dec 7 Holiday')).toBeInTheDocument();
      });

      // Dec 7 Office 1 holiday must NOT be exposed (employee left Office 1)
      expect(screen.queryByText('Office 1 Dec 7 Holiday')).not.toBeInTheDocument();
      // Dec 4 Office 2 holiday must NOT be exposed (employee not yet at Office 2)
      expect(screen.queryByText('Office 2 Dec 4 Holiday')).not.toBeInTheDocument();
    });

    it('exposes organization-wide holidays only and shows warning when assignment lookup fails', async () => {
      vi.spyOn(assignmentApi, 'getAssignments').mockRejectedValue(
        new ApiError(500, 'Assignment service unavailable')
      );

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('assignment-warning')).toBeInTheDocument();
        // Org-wide holiday remains visible
        expect(screen.getByTestId('optional-holiday-2026-12-05')).toBeInTheDocument();
      });

      // Office-specific holiday is NOT exposed
      expect(screen.queryByTestId('optional-holiday-2026-12-04')).not.toBeInTheDocument();
      expect(screen.getByText(/unable to verify employee office assignments/i)).toBeInTheDocument();
    });
  });

  describe('Optional Holiday Submission & Form State', () => {
    it('submits selected optional holiday in payload and excludes deselected ones', async () => {
      const user = userEvent.setup();

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-04')).toBeInTheDocument();
      });

      const checkbox = screen.getByTestId('optional-holiday-2026-12-04');
      await user.click(checkbox);
      expect(checkbox).toBeChecked();

      const reasonInput = screen.getByTestId('leave-reason-input');
      await user.type(reasonInput, 'Annual break with optional holiday');

      const submitBtn = screen.getByTestId('submit-leave-btn');
      await user.click(submitBtn);

      expect(mockOnSubmit).toHaveBeenCalledWith({
        start_date: '2026-12-04',
        end_date: '2026-12-07',
        leave_type: 'ANNUAL',
        reason: 'Annual break with optional holiday',
        optional_holiday_dates: ['2026-12-04'],
      });
    });

    it('omits optional_holiday_dates from payload when none are selected', async () => {
      const user = userEvent.setup();

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-04')).toBeInTheDocument();
      });

      const submitBtn = screen.getByTestId('submit-leave-btn');
      await user.click(submitBtn);

      const payload = mockOnSubmit.mock.calls[0][0];
      expect(payload.optional_holiday_dates).toBeUndefined();
    });

    it('cleans up selected dates that are no longer applicable when date range changes', async () => {
      const user = userEvent.setup();

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-04')).toBeInTheDocument();
      });

      const checkbox = screen.getByTestId('optional-holiday-2026-12-04');
      await user.click(checkbox);
      expect(checkbox).toBeChecked();

      // Change date range to Dec 10–12
      vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({
        items: [
          {
            id: 301,
            holiday_date: '2026-12-11',
            name: 'Dec 11 Holiday',
            description: null,
            office_id: 1,
            office_name: 'Test Office',
            office_code: 'TEST-01',
            is_optional: true,
            created_by_user_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
      });

      fireEvent.change(startDateInput, { target: { value: '2026-12-10' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-12' } });

      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-11')).toBeInTheDocument();
      });

      // Dec 04 is no longer in range and should not be submitted
      const submitBtn = screen.getByTestId('submit-leave-btn');
      await user.click(submitBtn);

      const payload = mockOnSubmit.mock.calls[0][0];
      expect(payload.optional_holiday_dates).toBeUndefined();
    });

    it('recalculates live preview and re-scopes optional holidays when Admin switches target employee ID', async () => {
      vi.spyOn(assignmentApi, 'getAssignments').mockImplementation(async (params) => {
        if (params?.employee_id === 1) {
          return sampleAssignments;
        }
        return [];
      });

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockAdminUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-04' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-07' } });

      // Initially for Admin (employee 99 without assignments):
      // Office 1 holiday on Dec 4 is NOT exposed
      await waitFor(() => {
        expect(screen.getByTestId('working-days-preview')).toHaveTextContent(
          'Estimated Duration: 2 working days'
        );
      });
      expect(screen.queryByTestId('optional-holiday-2026-12-04')).not.toBeInTheDocument();

      // Admin enters Target Employee ID = '1'
      const empIdInput = screen.getByLabelText(/target employee id/i);
      fireEvent.change(empIdInput, { target: { value: '1' } });

      // Now for Employee 1 (Office 1): Office 1 optional holiday appears
      await waitFor(() => {
        expect(screen.getByTestId('optional-holiday-2026-12-04')).toBeInTheDocument();
      });
    });
  });

  describe('Leave Application Balance Awareness', () => {
    const sampleBalances: EmployeeLeaveBalanceSummary = {
      employee_id: 1,
      employee_code: 'EMP-001',
      employee_name: 'John Doe',
      department: 'Engineering',
      year: 2026,
      balances: [
        {
          leave_type: 'ANNUAL',
          is_enforced: true,
          allocated_days: 15,
          used_days: 5,
          pending_days: 2,
          available_days: 8,
          is_override: false,
        },
        {
          leave_type: 'SICK',
          is_enforced: true,
          allocated_days: 10,
          used_days: 1,
          pending_days: 0,
          available_days: 9,
          is_override: true,
        },
        {
          leave_type: 'CASUAL',
          is_enforced: false,
          allocated_days: null,
          used_days: 2,
          pending_days: 0,
          available_days: null,
          is_override: false,
        },
        {
          leave_type: 'UNPAID',
          is_enforced: false,
          allocated_days: null,
          used_days: 0,
          pending_days: 0,
          available_days: null,
          is_override: false,
        },
      ],
    };

    beforeEach(() => {
      vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({ items: [], total: 0 });
      vi.spyOn(officeApi, 'getOffices').mockResolvedValue(sampleOffices);
      vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue(sampleAssignments);
      vi.spyOn(leaveApi, 'getEmployeeLeaveBalances').mockResolvedValue(sampleBalances);
    });

    it('fetches and displays available and allocated days for ANNUAL leave', async () => {
      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('leave-balance-display')).toBeInTheDocument();
      });

      expect(screen.getByTestId('available-days-count')).toHaveTextContent('8 days');
      expect(screen.getByTestId('allocated-days-count')).toHaveTextContent('of 15 days allocated');
      expect(screen.getByTestId('pending-days-count')).toHaveTextContent('(2d pending)');
      expect(screen.queryByTestId('balance-override-badge')).not.toBeInTheDocument();
    });

    it('updates balance display immediately when changing leave type to SICK or CASUAL', async () => {
      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('leave-balance-display')).toBeInTheDocument();
      });

      // Switch to SICK
      const leaveTypeSelect = screen.getByLabelText(/leave category/i);
      fireEvent.change(leaveTypeSelect, { target: { value: 'SICK' } });

      await waitFor(() => {
        expect(screen.getByTestId('available-days-count')).toHaveTextContent('9 days');
      });
      expect(screen.getByTestId('allocated-days-count')).toHaveTextContent('of 10 days allocated');
      expect(screen.getByTestId('balance-override-badge')).toBeInTheDocument();

      // Switch to CASUAL (unconfigured)
      fireEvent.change(leaveTypeSelect, { target: { value: 'CASUAL' } });

      await waitFor(() => {
        expect(screen.getByTestId('leave-balance-unconfigured')).toBeInTheDocument();
      });
      expect(
        screen.getByText('Balance enforcement is not configured for this leave category.')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('available-days-count')).not.toBeInTheDocument();
    });

    it('shows inline warning when requested duration exceeds available balance and allows submission', async () => {
      const user = userEvent.setup();

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('leave-balance-display')).toBeInTheDocument();
      });

      // Request 10 working days: Monday Dec 07 to Friday Dec 18 (10 working days)
      const startDateInput = screen.getByTestId('leave-start-date-input');
      const endDateInput = screen.getByTestId('leave-end-date-input');
      fireEvent.change(startDateInput, { target: { value: '2026-12-07' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-18' } });

      await waitFor(() => {
        expect(screen.getByTestId('working-days-preview')).toHaveTextContent('10 working days');
      });

      // Available is 8 days, duration is 10 days -> warning shown!
      expect(screen.getByTestId('insufficient-balance-warning')).toBeInTheDocument();
      expect(screen.getByTestId('insufficient-balance-warning')).toHaveTextContent(
        'Requested leave duration (10 working days) exceeds your available balance (8 days)'
      );

      // Submission is NOT blocked by frontend
      const submitBtn = screen.getByTestId('submit-leave-btn');
      expect(submitBtn).not.toBeDisabled();
      await user.click(submitBtn);

      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          start_date: '2026-12-07',
          end_date: '2026-12-18',
          leave_type: 'ANNUAL',
        })
      );
    });

    it('displays loading and error states safely when balance fetch fails', async () => {
      vi.spyOn(leaveApi, 'getEmployeeLeaveBalances').mockRejectedValue(
        new ApiError(503, 'Balance service temporarily unavailable')
      );

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockEmployeeUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('leave-balance-error')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/Unable to load balance: Balance service temporarily unavailable/i)
      ).toBeInTheDocument();
    });

    it('re-fetches balance when Admin changes target employee ID', async () => {
      const otherEmployeeBalances: EmployeeLeaveBalanceSummary = {
        employee_id: 2,
        employee_code: 'EMP-002',
        employee_name: 'Bob Jones',
        department: 'Support',
        year: 2026,
        balances: [
          {
            leave_type: 'ANNUAL',
            is_enforced: true,
            allocated_days: 20,
            used_days: 0,
            pending_days: 0,
            available_days: 20,
            is_override: false,
          },
        ],
      };

      vi.spyOn(leaveApi, 'getEmployeeLeaveBalances').mockImplementation(async (empId) => {
        if (empId === 2) return otherEmployeeBalances;
        return sampleBalances;
      });

      render(
        <LeaveModal
          isOpen={true}
          currentUser={mockAdminUser}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      // Initially Admin (emp 99)
      await waitFor(() => {
        expect(leaveApi.getEmployeeLeaveBalances).toHaveBeenCalledWith(99, 2026);
      });

      // Admin types Target Employee ID = '2' and blurs
      const empIdInput = screen.getByLabelText(/target employee id/i);
      fireEvent.change(empIdInput, { target: { value: '2' } });
      fireEvent.blur(empIdInput);

      await waitFor(() => {
        expect(leaveApi.getEmployeeLeaveBalances).toHaveBeenCalledWith(2, 2026);
        expect(screen.getByTestId('available-days-count')).toHaveTextContent('20 days');
      });
    });
  });
});
