import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserManagementView } from './UserManagementView';
import * as userManagementApi from '../api/userManagementApi';
import * as employeeApi from '../api/employeeApi';
import type { User } from '../types/auth';
import type { UserAccount } from '../types/userManagement';
import type { Employee } from '../types/employee';

const mockAdmin: User = {
  id: 1,
  employee_id: null,
  full_name: 'Admin User',
  email: 'admin@example.com',
  role: 'ADMIN',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockUsers: UserAccount[] = [
  {
    id: 1,
    employee_id: null,
    full_name: 'Admin User',
    email: 'admin@example.com',
    role: 'ADMIN',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
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
  },
  {
    id: 3,
    employee_id: 20,
    full_name: 'Edward Employee',
    email: 'edward@example.com',
    role: 'EMPLOYEE',
    is_active: false,
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    employee_code: 'EMP001',
    department: 'Sales',
  },
];

const mockEmployees: Employee[] = [
  {
    id: 10,
    employee_code: 'MGR001',
    first_name: 'Marcus',
    last_name: 'Manager',
    email: 'marcus@example.com',
    department: 'Engineering',
    designation: 'Lead',
    joining_date: '2025-01-01',
    is_active: true,
  },
  {
    id: 20,
    employee_code: 'EMP001',
    first_name: 'Edward',
    last_name: 'Employee',
    email: 'edward@example.com',
    department: 'Sales',
    designation: 'Engineer',
    joining_date: '2025-02-01',
    is_active: true,
  },
];

describe('UserManagementView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(userManagementApi, 'getUsers').mockResolvedValue(mockUsers);
    vi.spyOn(employeeApi, 'getEmployees').mockResolvedValue(mockEmployees);
  });

  it('renders user management header, metrics cards, and table', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    expect(await screen.findByRole('heading', { name: /User Account Management/i })).toBeInTheDocument();

    // Verify metrics
    expect(screen.getByText('Total Accounts')).toBeInTheDocument();
    expect(screen.getByText('Active Accounts')).toBeInTheDocument();
    expect(screen.getByText('Disabled Accounts')).toBeInTheDocument();

    // Table rows
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('Marcus Manager')).toBeInTheDocument();
    expect(screen.getByText('Edward Employee')).toBeInTheDocument();
  });

  it('disables self-deactivation button for the current admin', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    // The disable button for the logged in admin should be disabled
    const adminRow = screen.getByText('Admin User').closest('tr');
    const buttons = adminRow?.querySelectorAll('button') || [];
    const disableBtn = Array.from(buttons).find((b) => b.textContent?.includes('Disable'));
    expect(disableBtn).toBeDisabled();
    expect(disableBtn).toHaveAttribute('title', 'Cannot disable own account');
  });

  it('toggles user status between disabled and enabled', async () => {
    const updateSpy = vi.spyOn(userManagementApi, 'updateUserStatus').mockResolvedValue({
      ...mockUsers[2],
      is_active: true,
    });

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Edward Employee');

    // Edward is disabled, so button is "Enable"
    const edwardRow = screen.getByText('Edward Employee').closest('tr');
    const enableBtn = Array.from(edwardRow?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Enable')
    );
    expect(enableBtn).toBeDefined();

    fireEvent.click(enableBtn!);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(3, { is_active: true });
    });
  });

  it('opens reset password modal when reset password button is clicked', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Marcus Manager');

    const marcusRow = screen.getByText('Marcus Manager').closest('tr');
    const resetBtn = Array.from(marcusRow?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Reset Password')
    );
    expect(resetBtn).toBeDefined();

    fireEvent.click(resetBtn!);

    expect(await screen.findByRole('dialog', { name: /Reset User Password/i })).toBeInTheDocument();
    expect(screen.getByText(/Target User:/i)).toBeInTheDocument();
  });

  it('filters users by search text', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Marcus Manager');

    const searchInput = screen.getByLabelText(/Search user accounts/i);
    fireEvent.change(searchInput, { target: { value: 'Edward' } });

    expect(screen.queryByText('Marcus Manager')).not.toBeInTheDocument();
    expect(screen.getByText('Edward Employee')).toBeInTheDocument();
  });
});
