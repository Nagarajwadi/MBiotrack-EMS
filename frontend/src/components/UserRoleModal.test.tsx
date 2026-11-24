import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserRoleModal } from './UserRoleModal';
import type { UserAccount } from '../types/userManagement';

const mockEmployeeUser: UserAccount = {
  id: 3,
  employee_id: 20,
  full_name: 'Edward Employee',
  email: 'edward@example.com',
  role: 'EMPLOYEE',
  is_active: true,
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
  employee_code: 'EMP001',
  department: 'Sales',
};

const mockManagerUser: UserAccount = {
  id: 2,
  employee_id: 10,
  full_name: 'Marcus Manager',
  email: 'marcus@example.com',
  role: 'MANAGER',
  is_active: true,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  employee_code: 'MGR001',
  department: 'Engineering',
};

describe('UserRoleModal', () => {
  it('does not render when isOpen is false or user is null', () => {
    const { rerender } = render(
      <UserRoleModal
        isOpen={false}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <UserRoleModal
        isOpen={true}
        user={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays the target user name, email, and current role', () => {
    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /change user role/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Edward Employee')).toBeInTheDocument();
    expect(screen.getByText('edward@example.com')).toBeInTheDocument();
    const summaryBox = dialog.querySelector('.reset-user-summary');
    expect(summaryBox).toHaveTextContent('EMPLOYEE');
  });

  it('never offers ADMIN as a selectable role', () => {
    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const select = screen.getByLabelText(/new role/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((opt) => opt.value);

    expect(optionValues).toContain('EMPLOYEE');
    expect(optionValues).toContain('MANAGER');
    expect(optionValues).not.toContain('ADMIN');
    expect(screen.queryByRole('option', { name: /admin/i })).not.toBeInTheDocument();
  });

  it('sends correct payload for employee-to-manager promotion', async () => {
    const submitSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn();

    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={closeSpy}
        onSubmit={submitSpy}
      />
    );

    const select = screen.getByLabelText(/new role/i);
    fireEvent.change(select, { target: { value: 'MANAGER' } });

    const submitBtn = screen.getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(mockEmployeeUser.id, { role: 'MANAGER' });
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  it('sends correct payload for manager-to-employee demotion', async () => {
    const submitSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn();

    render(
      <UserRoleModal
        isOpen={true}
        user={mockManagerUser}
        onClose={closeSpy}
        onSubmit={submitSpy}
      />
    );

    const select = screen.getByLabelText(/new role/i);
    fireEvent.change(select, { target: { value: 'EMPLOYEE' } });

    const submitBtn = screen.getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(mockManagerUser.id, { role: 'EMPLOYEE' });
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  it('prevents duplicate submissions and disables buttons during update', async () => {
    let resolveSubmit: () => void = () => {};
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const submitSpy = vi.fn().mockReturnValue(submitPromise);

    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={submitSpy}
      />
    );

    const select = screen.getByLabelText(/new role/i);
    fireEvent.change(select, { target: { value: 'MANAGER' } });

    const submitBtn = screen.getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    // Button updates to loading state and is disabled
    expect(screen.getByRole('button', { name: /updating\.\.\./i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(select).toBeDisabled();

    // Resolve submission
    resolveSubmit();

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('displays API errors clearly when submission fails', async () => {
    const submitSpy = vi.fn().mockRejectedValue(new Error('Operation not permitted by server.'));

    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={submitSpy}
      />
    );

    const select = screen.getByLabelText(/new role/i);
    fireEvent.change(select, { target: { value: 'MANAGER' } });

    const submitBtn = screen.getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('role-modal-error')).toHaveTextContent(
        'Operation not permitted by server.'
      );
    });
  });

  it('shows validation error when attempting to assign the current role', async () => {
    const submitSpy = vi.fn();

    render(
      <UserRoleModal
        isOpen={true}
        user={mockEmployeeUser}
        onClose={vi.fn()}
        onSubmit={submitSpy}
      />
    );

    const select = screen.getByLabelText(/new role/i);
    // Explicitly set to current role (EMPLOYEE)
    fireEvent.change(select, { target: { value: 'EMPLOYEE' } });

    const submitBtn = screen.getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    expect(screen.getByTestId('role-modal-error')).toHaveTextContent(
      'User is already assigned the EMPLOYEE role.'
    );
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
