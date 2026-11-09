import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordModal } from './ResetPasswordModal';
import type { UserAccount } from '../types/userManagement';

const mockTargetUser: UserAccount = {
  id: 42,
  employee_id: 15,
  full_name: 'Sarah Connor',
  email: 'sconnor@example.com',
  role: 'EMPLOYEE',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  employee_code: 'EMP042',
  department: 'Operations',
};

describe('ResetPasswordModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when isOpen is false or user is null', () => {
    const { container: c1 } = render(
      <ResetPasswordModal
        isOpen={false}
        user={mockTargetUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <ResetPasswordModal
        isOpen={true}
        user={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('displays target user info and input fields', () => {
    render(
      <ResetPasswordModal
        isOpen={true}
        user={mockTargetUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: /Reset User Password/i })).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
    expect(screen.getByText('sconnor@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText(/New Temporary Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Temporary Password/i)).toBeInTheDocument();
  });

  it('validates minimum 12 characters', async () => {
    const user = userEvent.setup();
    render(
      <ResetPasswordModal
        isOpen={true}
        user={mockTargetUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/New Temporary Password/i), 'Short123!');
    await user.type(screen.getByLabelText(/Confirm Temporary Password/i), 'Short123!');

    await user.click(screen.getByRole('button', { name: /Reset Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters long/i);
  });

  it('validates confirmation mismatch', async () => {
    const user = userEvent.setup();
    render(
      <ResetPasswordModal
        isOpen={true}
        user={mockTargetUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText(/New Temporary Password/i), 'TemporaryPass123!');
    await user.type(screen.getByLabelText(/Confirm Temporary Password/i), 'DifferentPass123!');

    await user.click(screen.getByRole('button', { name: /Reset Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Passwords do not match/i);
  });

  it('submits successfully and triggers onClose', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ResetPasswordModal
        isOpen={true}
        user={mockTargetUser}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText(/New Temporary Password/i), 'TemporaryPass123!');
    await user.type(screen.getByLabelText(/Confirm Temporary Password/i), 'TemporaryPass123!');

    await user.click(screen.getByRole('button', { name: /Reset Password/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(42, {
        new_password: 'TemporaryPass123!',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
