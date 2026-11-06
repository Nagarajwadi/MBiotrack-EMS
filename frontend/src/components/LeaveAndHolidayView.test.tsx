import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as holidayApi from '../api/holidayApi';
import * as leaveApi from '../api/leaveApi';
import * as officeApi from '../api/officeApi';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
} from '../test/fixtures/authFixtures';
import type { HolidayDetail } from '../types/holiday';
import type { LeaveRequestDetail } from '../types/leave';
import type { Office } from '../types/office';
import { LeaveAndHolidayView } from './LeaveAndHolidayView';

describe('LeaveAndHolidayView component', () => {
  const sampleOffices: Office[] = [
    {
      id: 1,
      name: 'Headquarters',
      code: 'HQ',
      timezone: 'Asia/Kolkata',
      address: 'Main St',
      is_active: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 2,
      name: 'Branch West',
      code: 'BR-W',
      timezone: 'Asia/Kolkata',
      address: 'West St',
      is_active: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
  ];

  const sampleLeaves: LeaveRequestDetail[] = [
    {
      id: 101,
      employee_id: 1, // matches mockAdminUser.employee_id
      employee_name: 'Admin User',
      employee_code: 'ADM-001',
      department: 'Management',
      start_date: '2026-11-10',
      end_date: '2026-11-12',
      leave_type: 'ANNUAL',
      reason: 'Personal holiday',
      status: 'PENDING',
      decision_by_user_id: null,
      decision_by_user_name: null,
      decision_notes: null,
      decided_at: null,
      created_at: '2026-11-06T10:00:00Z',
      updated_at: '2026-11-06T10:00:00Z',
    },
    {
      id: 102,
      employee_id: 2, // different employee
      employee_name: 'Jane Colleague',
      employee_code: 'EMP-002',
      department: 'Engineering',
      start_date: '2026-11-15',
      end_date: '2026-11-15',
      leave_type: 'SICK',
      reason: 'Doctor appointment',
      status: 'PENDING',
      decision_by_user_id: null,
      decision_by_user_name: null,
      decision_notes: null,
      decided_at: null,
      created_at: '2026-11-06T10:30:00Z',
      updated_at: '2026-11-06T10:30:00Z',
    },
    {
      id: 103,
      employee_id: 2,
      employee_name: 'Jane Colleague',
      employee_code: 'EMP-002',
      department: 'Engineering',
      start_date: '2026-10-01',
      end_date: '2026-10-02',
      leave_type: 'CASUAL',
      reason: 'Family visit',
      status: 'APPROVED',
      decision_by_user_id: 1,
      decision_by_user_name: 'Admin User',
      decision_notes: 'Approved as planned',
      decided_at: '2026-09-28T09:00:00Z',
      created_at: '2026-09-25T10:00:00Z',
      updated_at: '2026-09-28T09:00:00Z',
    },
    {
      id: 104,
      employee_id: 3, // matches mockEmployeeUser.employee_id
      employee_name: 'Charlie Employee',
      employee_code: 'EMP-003',
      department: 'Support',
      start_date: '2026-11-20',
      end_date: '2026-11-21',
      leave_type: 'ANNUAL',
      reason: 'Weekend trip',
      status: 'PENDING',
      decision_by_user_id: null,
      decision_by_user_name: null,
      decision_notes: null,
      decided_at: null,
      created_at: '2026-11-06T11:00:00Z',
      updated_at: '2026-11-06T11:00:00Z',
    },
  ];

  const sampleHolidays: HolidayDetail[] = [
    {
      id: 201,
      holiday_date: '2026-12-25',
      name: 'Christmas Day',
      description: 'Public holiday',
      office_id: null,
      office_name: null,
      office_code: null,
      is_optional: false,
      created_by_user_id: 1,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 202,
      holiday_date: '2026-11-15',
      name: 'West Branch Anniversary',
      description: 'Branch holiday',
      office_id: 2,
      office_name: 'Branch West',
      office_code: 'BR-W',
      is_optional: true,
      created_by_user_id: 1,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(officeApi, 'getOffices').mockResolvedValue(sampleOffices);
    vi.spyOn(leaveApi, 'getLeaveRequests').mockResolvedValue({
      items: sampleLeaves,
      total: sampleLeaves.length,
      limit: 20,
      offset: 0,
    });
    vi.spyOn(holidayApi, 'getHolidays').mockResolvedValue({
      items: sampleHolidays,
      total: sampleHolidays.length,
    });
    vi.spyOn(leaveApi, 'submitLeaveRequest').mockResolvedValue(sampleLeaves[0]);
    vi.spyOn(leaveApi, 'reviewLeaveRequest').mockResolvedValue(sampleLeaves[1]);
    vi.spyOn(leaveApi, 'cancelLeaveRequest').mockResolvedValue(sampleLeaves[0]);
    vi.spyOn(holidayApi, 'createHoliday').mockResolvedValue(sampleHolidays[0]);
    vi.spyOn(holidayApi, 'updateHoliday').mockResolvedValue(sampleHolidays[0]);
    vi.spyOn(holidayApi, 'deleteHoliday').mockResolvedValue(undefined);
  });

  describe('Leave Requests tab rendering and interactions', () => {
    it('renders leave requests table, summary metrics, and filters for ADMIN', async () => {
      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      expect(screen.getByRole('heading', { level: 2, name: /leaves & holidays/i })).toBeInTheDocument();
      expect(screen.getByTestId('tab-leave-requests')).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => {
        expect(screen.getByTestId('metric-total-leaves')).toHaveTextContent('4');
      });

      expect(screen.getByTestId('leave-table')).toBeInTheDocument();
      expect(screen.getByText('Personal holiday')).toBeInTheDocument();
      expect(screen.getByText('Doctor appointment')).toBeInTheDocument();
      expect(screen.getAllByText('Jane Colleague').length).toBeGreaterThan(0);
    });

    it('strictly blocks self-approval on pending request owned by logged-in user', async () => {
      // mockAdminUser has employee_id === 1. Request #101 belongs to employee_id: 1.
      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('leave-row-101')).toBeInTheDocument();
      });

      // For request 101 (own request): self-approval blocked indicator must be displayed
      expect(screen.getByTestId('self-approval-blocked-101')).toHaveTextContent(/self-approval blocked/i);
      expect(screen.queryByTestId('approve-leave-btn-101')).not.toBeInTheDocument();
      expect(screen.queryByTestId('reject-leave-btn-101')).not.toBeInTheDocument();

      // For request 102 (colleague request): Approve & Reject buttons must be present
      expect(screen.getByTestId('approve-leave-btn-102')).toBeInTheDocument();
      expect(screen.getByTestId('reject-leave-btn-102')).toBeInTheDocument();
    });

    it('allows Manager or Admin to approve another employee request with optional notes', async () => {
      const user = userEvent.setup();
      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('approve-leave-btn-102')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('approve-leave-btn-102'));

      // Review modal opens
      expect(screen.getByRole('heading', { level: 2, name: /approve leave request/i })).toBeInTheDocument();
      const notesInput = screen.getByTestId('review-decision-notes-input');
      await user.type(notesInput, 'Looks good, cover arranged');

      const confirmBtn = screen.getByTestId('confirm-review-btn');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(leaveApi.reviewLeaveRequest).toHaveBeenCalledWith(102, {
          decision: 'APPROVED',
          decision_notes: 'Looks good, cover arranged',
        });
      });
    });

    it('allows Manager or Admin to reject another employee request with notes', async () => {
      const user = userEvent.setup();
      render(<LeaveAndHolidayView currentUser={mockManagerUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('reject-leave-btn-101')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('reject-leave-btn-101'));

      expect(screen.getByRole('heading', { level: 2, name: /reject leave request/i })).toBeInTheDocument();
      const notesInput = screen.getByTestId('review-decision-notes-input');
      await user.type(notesInput, 'Understaffed during that week');

      const confirmBtn = screen.getByTestId('confirm-review-btn');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(leaveApi.reviewLeaveRequest).toHaveBeenCalledWith(101, {
          decision: 'REJECTED',
          decision_notes: 'Understaffed during that week',
        });
      });
    });

    it('submits a new leave request via LeaveModal', async () => {
      const user = userEvent.setup();
      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      const requestBtn = screen.getByTestId('request-leave-btn');
      await user.click(requestBtn);

      // LeaveModal opens
      expect(screen.getByRole('heading', { level: 2, name: /request leave/i })).toBeInTheDocument();

      const reasonInput = screen.getByTestId('leave-reason-input');
      await user.type(reasonInput, 'Taking a short break');

      const submitBtn = screen.getByTestId('submit-leave-btn');
      await user.click(submitBtn);

      await waitFor(() => {
        expect(leaveApi.submitLeaveRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            leave_type: 'ANNUAL',
            reason: 'Taking a short break',
          })
        );
      });
    });

    it('allows employee to cancel their pending leave request', async () => {
      const user = userEvent.setup();
      // Employee with employee_id = 3
      render(<LeaveAndHolidayView currentUser={mockEmployeeUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('cancel-leave-btn-104')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('cancel-leave-btn-104'));

      expect(screen.getByRole('heading', { level: 2, name: /cancel leave request/i })).toBeInTheDocument();
      const reasonInput = screen.getByTestId('cancel-reason-input');
      await user.type(reasonInput, 'Plans cancelled');

      const confirmBtn = screen.getByTestId('confirm-cancel-btn');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(leaveApi.cancelLeaveRequest).toHaveBeenCalledWith(104);
      });
    });
  });

  describe('Holiday Calendar tab rendering and interactions', () => {
    it('switches to Holiday Calendar tab and displays holidays', async () => {
      const user = userEvent.setup();
      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      const holidayTabBtn = screen.getByTestId('tab-holiday-calendar');
      await user.click(holidayTabBtn);

      expect(holidayTabBtn).toHaveAttribute('aria-selected', 'true');

      await waitFor(() => {
        expect(screen.getByTestId('holiday-table')).toBeInTheDocument();
      });

      expect(screen.getByText('Christmas Day')).toBeInTheDocument();
      expect(screen.getByText('West Branch Anniversary')).toBeInTheDocument();
      expect(screen.getByTestId('holiday-scope-org-201')).toHaveTextContent(/org-wide/i);
      expect(screen.getByTestId('holiday-scope-office-202')).toHaveTextContent(/branch west/i);
    });

    it('allows ADMIN to create a new holiday via HolidayModal', async () => {
      const user = userEvent.setup();
      render(
        <LeaveAndHolidayView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialSubTab="holidays"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('add-holiday-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('add-holiday-btn'));

      expect(screen.getByRole('heading', { level: 2, name: /add holiday/i })).toBeInTheDocument();
      const nameInput = screen.getByTestId('holiday-name-input');
      await user.type(nameInput, 'Republic Day');

      const submitBtn = screen.getByTestId('submit-holiday-btn');
      await user.click(submitBtn);

      await waitFor(() => {
        expect(holidayApi.createHoliday).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Republic Day',
            office_id: null,
            is_optional: false,
          })
        );
      });
    });

    it('allows ADMIN to delete a holiday with confirmation', async () => {
      const user = userEvent.setup();
      render(
        <LeaveAndHolidayView
          currentUser={mockAdminUser}
          sessionEpoch={1}
          initialSubTab="holidays"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-holiday-btn-201')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('delete-holiday-btn-201'));

      expect(screen.getByRole('heading', { level: 2, name: /delete holiday/i })).toBeInTheDocument();
      const confirmBtn = screen.getByTestId('confirm-delete-holiday-btn');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(holidayApi.deleteHoliday).toHaveBeenCalledWith(201);
      });
    });

    it('hides Add and Delete actions for EMPLOYEE', async () => {
      render(
        <LeaveAndHolidayView
          currentUser={mockEmployeeUser}
          sessionEpoch={1}
          initialSubTab="holidays"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('holiday-table')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('add-holiday-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-holiday-btn-201')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-holiday-btn-201')).not.toBeInTheDocument();
    });
  });

  describe('Loading, Empty, and Error States', () => {
    it('displays empty state when no leave requests match', async () => {
      vi.spyOn(leaveApi, 'getLeaveRequests').mockResolvedValueOnce({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('leave-empty-state')).toBeInTheDocument();
      });
    });

    it('displays error banner when leave requests fetch fails', async () => {
      vi.spyOn(leaveApi, 'getLeaveRequests').mockRejectedValueOnce(new Error('Network disconnected'));

      render(<LeaveAndHolidayView currentUser={mockAdminUser} sessionEpoch={1} />);

      await waitFor(() => {
        expect(screen.getByTestId('leave-error-banner')).toHaveTextContent('Network disconnected');
      });
    });
  });
});
