import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as leaveApi from '../api/leaveApi';
import { ApiError } from '../api/apiError';
import { LeaveBalanceLedgerModal } from './LeaveBalanceLedgerModal';
import type { LeaveBalanceLedgerItem } from '../types/leave';

describe('LeaveBalanceLedgerModal Component', () => {
  const mockOnClose = vi.fn();

  const sampleLedgerEntries: LeaveBalanceLedgerItem[] = [
    {
      id: 1,
      leave_request_id: 101,
      employee_id: 5,
      year: 2026,
      leave_type: 'ANNUAL',
      transaction_type: 'INITIAL_ALLOCATION',
      days: 15,
      created_by_user_id: 1,
      created_at: '2026-01-01T09:00:00Z',
    },
    {
      id: 2,
      leave_request_id: 102,
      employee_id: 5,
      year: 2026,
      leave_type: 'ANNUAL',
      transaction_type: 'RESERVATION',
      days: -3,
      created_by_user_id: 2,
      created_at: '2026-03-10T14:30:00Z',
    },
    {
      id: 3,
      leave_request_id: 102,
      employee_id: 5,
      year: 2026,
      leave_type: 'ANNUAL',
      transaction_type: 'CONSUMPTION',
      days: -3,
      created_by_user_id: 1,
      created_at: '2026-03-11T11:00:00Z',
    },
    {
      id: 4,
      leave_request_id: 103,
      employee_id: 5,
      year: 2026,
      leave_type: 'SICK',
      transaction_type: 'RESERVATION_RELEASE',
      days: 2,
      created_by_user_id: 1,
      created_at: '2026-04-05T16:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(
      <LeaveBalanceLedgerModal
        isOpen={false}
        employeeId={5}
        employeeName="Alice Smith"
        year={2026}
        onClose={mockOnClose}
      />
    );

    expect(screen.queryByTestId('leave-balance-ledger-modal')).not.toBeInTheDocument();
  });

  it('renders loading state initially while fetching ledger entries', () => {
    vi.spyOn(leaveApi, 'getEmployeeBalanceLedger').mockImplementation(() => new Promise(() => {}));

    render(
      <LeaveBalanceLedgerModal
        isOpen={true}
        employeeId={5}
        employeeName="Alice Smith"
        year={2026}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByTestId('ledger-loading-state')).toBeInTheDocument();
    expect(screen.getByText('Loading balance history transactions...')).toBeInTheDocument();
  });

  it('renders ledger entries, transaction types, request reference and signs correctly', async () => {
    vi.spyOn(leaveApi, 'getEmployeeBalanceLedger').mockResolvedValue(sampleLedgerEntries);

    render(
      <LeaveBalanceLedgerModal
        isOpen={true}
        employeeId={5}
        employeeName="Alice Smith"
        year={2026}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-table')).toBeInTheDocument();
    });

    // Check title and employee name
    expect(screen.getByText(/Leave Balance History \(2026\)/i)).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();

    // Check row entries
    expect(screen.getByTestId('ledger-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-type-1')).toHaveTextContent('ANNUAL');
    expect(screen.getByText('Initial Allocation')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-days-1')).toHaveTextContent('+15 days');
    expect(screen.getByTestId('ledger-ref-1')).toHaveTextContent('#101');

    // Check negative days
    expect(screen.getByTestId('ledger-row-2')).toBeInTheDocument();
    expect(screen.getByText('Reservation (Pending)')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-days-2')).toHaveTextContent('-3 days');
    expect(screen.getByTestId('ledger-ref-2')).toHaveTextContent('#102');

    // Check reservation release positive
    expect(screen.getByTestId('ledger-row-4')).toBeInTheDocument();
    expect(screen.getByText('Reservation Release')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-days-4')).toHaveTextContent('+2 days');
  });

  it('renders empty state when employee has no ledger transactions', async () => {
    vi.spyOn(leaveApi, 'getEmployeeBalanceLedger').mockResolvedValue([]);

    render(
      <LeaveBalanceLedgerModal
        isOpen={true}
        employeeId={5}
        employeeName="Bob Jones"
        year={2026}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No balance transactions recorded')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-table')).not.toBeInTheDocument();
  });

  it('renders error banner when API call fails', async () => {
    vi.spyOn(leaveApi, 'getEmployeeBalanceLedger').mockRejectedValue(
      new ApiError(403, 'Managers may only view ledger for employees in their department.')
    );

    render(
      <LeaveBalanceLedgerModal
        isOpen={true}
        employeeId={99}
        employeeName="Restricted Employee"
        year={2026}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-error-banner')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Managers may only view ledger for employees in their department.')
    ).toBeInTheDocument();
  });

  it('dismisses modal via close button, backdrop click, or Escape key', async () => {
    vi.spyOn(leaveApi, 'getEmployeeBalanceLedger').mockResolvedValue([]);

    render(
      <LeaveBalanceLedgerModal
        isOpen={true}
        employeeId={5}
        employeeName="Alice Smith"
        year={2026}
        onClose={mockOnClose}
      />
    );

    // Close button
    fireEvent.click(screen.getByTestId('ledger-modal-close-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Dismiss button in footer
    fireEvent.click(screen.getByTestId('ledger-modal-dismiss-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(2);

    // Backdrop click
    fireEvent.click(screen.getByTestId('leave-balance-ledger-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalledTimes(3);

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(4);
  });
});
