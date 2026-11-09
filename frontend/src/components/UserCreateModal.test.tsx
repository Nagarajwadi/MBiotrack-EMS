import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserCreateModal } from './UserCreateModal';
import type { Employee } from '../types/employee';

const mockEmployees: Employee[] = [
  {
    id: 1,
    employee_code: 'EMP001',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    department: 'Engineering',
    designation: 'Engineer',
    joining_date: '2025-01-01',
    is_active: true,
  },
  {
    id: 2,
    employee_code: 'EMP002',
    first_name: 'Jane',
    last_name: 'Smith',
    email: 'jane@example.com',
    department: 'Sales',
    designation: 'Sales Rep',
    joining_date: '2025-02-01',
    is_active: true,
  },
  {
    id: 3,
    employee_code: 'EMP003',
    first_name: 'Bob',
    last_name: 'Inactive',
    email: 'bob@example.com',
    department: 'HR',
    designation: 'HR Lead',
    joining_date: '2025-03-01',
    is_active: false,
    deleted_at: '2025-06-01T00:00:00Z',
  },
];

describe('UserCreateModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <UserCreateModal
        isOpen={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        employees={mockEmployees}
        existingUserEmployeeIds={new Set([1])}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders and only lists active unprovisioned employees', () => {
    render(
      <UserCreateModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        employees={mockEmployees}
        existingUserEmployeeIds={new Set([1])} // John already has account
      />
    );

    expect(screen.getByRole('heading', { name: /Provision User Login Account/i })).toBeInTheDocument();
    const select = screen.getByLabelText(/Select Employee/i);
    expect(select).toBeInTheDocument();

    // Jane (EMP002) should be available, John (EMP001) should not, Bob (EMP003 inactive) should not
    expect(screen.queryByText(/John Doe \(EMP001\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Jane Smith \(EMP002\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Bob Inactive/i)).not.toBeInTheDocument();
  });

  it('validates password length and submits payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <UserCreateModal
        isOpen={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
        employees={mockEmployees}
        existingUserEmployeeIds={new Set()}
      />
    );

    // Select employee
    fireEvent.change(screen.getByLabelText(/Select Employee/i), { target: { value: '2' } });

    // Enter short password
    fireEvent.change(screen.getByLabelText(/Initial Password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /Provision Account/i }));

    expect(await screen.findByText(/Initial password must be at least 8 characters/i)).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();

    // Enter valid password
    fireEvent.change(screen.getByLabelText(/Initial Password/i), { target: { value: 'ValidPass123!' } });
    fireEvent.change(screen.getByLabelText(/Assign Role/i), { target: { value: 'MANAGER' } });

    fireEvent.click(screen.getByRole('button', { name: /Provision Account/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        employee_id: 2,
        role: 'MANAGER',
        initial_password: 'ValidPass123!',
        email: 'jane@example.com',
      });
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
