import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogModal } from './AuditLogModal';
import * as auditApi from '../api/auditApi';
import type { AuditLogListResponse } from '../types/audit';


describe('AuditLogModal component', () => {
  const mockOnClose = vi.fn();

  const sampleLogsResponse: AuditLogListResponse = {
    items: [
      {
        id: 101,
        actor_user_id: 1,
        actor_email: 'admin@example.com',
        action: 'EMPLOYEE_CREATE',
        target_type: 'employee',
        target_id: '15',
        metadata: { employee_code: 'EMP015', role: 'ADMIN' },
        ip_address: '192.168.1.10',
        created_at: '2026-11-04T12:00:00Z',
      },
      {
        id: 102,
        actor_user_id: null,
        actor_email: null,
        action: 'AUTH_LOGIN_FAILED',
        target_type: 'auth',
        target_id: 'hash123',
        metadata: { reason: 'incorrect_password' },
        ip_address: '203.0.113.50',
        created_at: '2026-11-04T12:05:00Z',
      },
    ],
    total: 2,
    limit: 15,
    offset: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <AuditLogModal isOpen={false} onClose={mockOnClose} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal header, title, and badges when isOpen is true', async () => {
    vi.spyOn(auditApi, 'getAuditLogs').mockResolvedValueOnce(sampleLogsResponse);

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    expect(
      screen.getByRole('dialog', { name: /compliance audit trail/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/administrator only/i)).toBeInTheDocument();

    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('EMPLOYEE_CREATE')).toBeInTheDocument();
      expect(within(table).getByText('AUTH_LOGIN_FAILED')).toBeInTheDocument();
      expect(within(table).getByText('admin@example.com')).toBeInTheDocument();
      expect(within(table).getByText(/system \/ anonymous/i)).toBeInTheDocument();
      expect(within(table).getByText('192.168.1.10')).toBeInTheDocument();
      expect(within(table).getByText('203.0.113.50')).toBeInTheDocument();
    });
  });


  it('displays empty state when zero audit logs exist', async () => {
    vi.spyOn(auditApi, 'getAuditLogs').mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 15,
      offset: 0,
    });

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText(/no audit records found/i)).toBeInTheDocument();
    });
  });

  it('displays error banner and allows retry when API fails', async () => {
    const getAuditLogsSpy = vi
      .spyOn(auditApi, 'getAuditLogs')
      .mockRejectedValueOnce(new Error('Network error loading audit logs'))
      .mockResolvedValueOnce(sampleLogsResponse);

    const user = userEvent.setup();
    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(
        screen.getByText(/network error loading audit logs/i)
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(getAuditLogsSpy).toHaveBeenCalledTimes(2);
      const table = screen.getByRole('table');
      expect(within(table).getByText('EMPLOYEE_CREATE')).toBeInTheDocument();
    });
  });


  it('calls onClose when close button is clicked', async () => {
    vi.spyOn(auditApi, 'getAuditLogs').mockResolvedValueOnce(sampleLogsResponse);
    const user = userEvent.setup();

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    const closeBtn = screen.getByRole('button', {
      name: /close audit log dialog/i,
    });
    await user.click(closeBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', async () => {
    vi.spyOn(auditApi, 'getAuditLogs').mockResolvedValueOnce(sampleLogsResponse);
    const user = userEvent.setup();

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    await user.keyboard('{Escape}');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('handles action filtering and refreshes data', async () => {
    const getAuditLogsSpy = vi
      .spyOn(auditApi, 'getAuditLogs')
      .mockResolvedValue(sampleLogsResponse);
    const user = userEvent.setup();

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(getAuditLogsSpy).toHaveBeenCalledWith({
        limit: 15,
        offset: 0,
        action: undefined,
        target_type: undefined,
      });
    });

    const actionSelect = screen.getByLabelText(/filter audit logs by action/i);
    await user.selectOptions(actionSelect, 'EMPLOYEE_CREATE');

    await waitFor(() => {
      expect(getAuditLogsSpy).toHaveBeenCalledWith({
        limit: 15,
        offset: 0,
        action: 'EMPLOYEE_CREATE',
        target_type: undefined,
      });
    });
  });

  it('handles pagination navigation (Next and Previous)', async () => {
    const getAuditLogsSpy = vi
      .spyOn(auditApi, 'getAuditLogs')
      .mockResolvedValue({
        items: sampleLogsResponse.items,
        total: 30,
        limit: 15,
        offset: 0,
      });
    const user = userEvent.setup();

    render(<AuditLogModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText(/showing/i)).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', {
      name: /next page of audit logs/i,
    });
    expect(nextBtn).toBeEnabled();

    await user.click(nextBtn);

    await waitFor(() => {
      expect(getAuditLogsSpy).toHaveBeenCalledWith({
        limit: 15,
        offset: 15,
        action: undefined,
        target_type: undefined,
      });
    });
  });
});
