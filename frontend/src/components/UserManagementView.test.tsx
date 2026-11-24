import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByText('Administrators')).toBeInTheDocument();
    expect(screen.getByText('Managers')).toBeInTheDocument();
    expect(screen.getByText('Employees')).toBeInTheDocument();

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

  it('renders enabled change role button for eligible accounts and disabled for logged-in admin', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    // Admin User (self): Change Role button is disabled
    const adminRow = screen.getByText('Admin User').closest('tr');
    const adminButtons = adminRow?.querySelectorAll('button') || [];
    const adminChangeRoleBtn = Array.from(adminButtons).find((b) =>
      b.textContent?.includes('Change Role')
    );
    expect(adminChangeRoleBtn).toBeDisabled();
    expect(adminChangeRoleBtn).toHaveAttribute('title', 'Cannot change own role');

    // Marcus Manager (eligible): Change Role button is enabled
    const marcusRow = screen.getByText('Marcus Manager').closest('tr');
    const marcusButtons = marcusRow?.querySelectorAll('button') || [];
    const marcusChangeRoleBtn = Array.from(marcusButtons).find((b) =>
      b.textContent?.includes('Change Role')
    );
    expect(marcusChangeRoleBtn).toBeEnabled();

    // Edward Employee (eligible): Change Role button is enabled
    const edwardRow = screen.getByText('Edward Employee').closest('tr');
    const edwardButtons = edwardRow?.querySelectorAll('button') || [];
    const edwardChangeRoleBtn = Array.from(edwardButtons).find((b) =>
      b.textContent?.includes('Change Role')
    );
    expect(edwardChangeRoleBtn).toBeEnabled();
  });

  it('promotes employee to manager via UserRoleModal, refreshing table and metrics', async () => {
    const updateRoleSpy = vi.spyOn(userManagementApi, 'updateUserRole').mockResolvedValue({
      ...mockUsers[2],
      role: 'MANAGER',
    });

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Edward Employee');

    // Check initial metrics: 1 Manager, 1 Employee
    const metricsGrid = document.querySelector('.management-metrics-grid');
    expect(metricsGrid).toHaveTextContent('Managers');
    expect(metricsGrid).toHaveTextContent('Employees');

    const edwardRow = screen.getByText('Edward Employee').closest('tr');
    const changeRoleBtn = Array.from(edwardRow?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Change Role')
    );
    expect(changeRoleBtn).toBeDefined();

    fireEvent.click(changeRoleBtn!);

    // Modal opens
    const modal = await screen.findByRole('dialog', { name: /change user role/i });
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText('Target User:')).toBeInTheDocument();

    const select = within(modal).getByLabelText(/new role/i);
    fireEvent.change(select, { target: { value: 'MANAGER' } });

    const submitBtn = within(modal).getByRole('button', { name: /change role/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(updateRoleSpy).toHaveBeenCalledWith(3, { role: 'MANAGER' });
    });

    // Feedback message appears
    expect(
      await screen.findByText(/Role for "Edward Employee" changed to MANAGER successfully\./i)
    ).toBeInTheDocument();

    // Edward's role badge in table is now MANAGER
    const updatedEdwardRow = screen.getByText('Edward Employee').closest('tr');
    expect(updatedEdwardRow?.querySelector('.user-role-badge')).toHaveTextContent('MANAGER');
  });

  it('counts administrators correctly and reconciles role totals with total accounts', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    const cards = document.querySelectorAll('.metric-card');
    const metricMap: Record<string, number> = {};
    cards.forEach((card) => {
      const label = card.querySelector('.metric-label')?.textContent?.trim() || '';
      const value = parseInt(card.querySelector('.metric-value')?.textContent?.trim() || '0', 10);
      metricMap[label] = value;
    });

    expect(metricMap['Total Accounts']).toBe(3);
    expect(metricMap['Administrators']).toBe(1);
    expect(metricMap['Managers']).toBe(1);
    expect(metricMap['Employees']).toBe(1);

    // Reconcile: Administrators + Managers + Employees === Total Accounts
    expect(metricMap['Administrators'] + metricMap['Managers'] + metricMap['Employees']).toBe(
      metricMap['Total Accounts']
    );
  });

  it('displays contextual empty state with reset filters button when filters exclude all users', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    const searchInput = screen.getByLabelText(/search user accounts/i);
    fireEvent.change(searchInput, { target: { value: 'NonExistentStaff' } });

    // Table rows disappear and contextual empty state renders
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    expect(
      screen.getByText(/User accounts exist, but none match the current search or filter criteria\./i)
    ).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /reset filters/i });
    expect(resetBtn).toBeInTheDocument();
  });

  it('resets all three filters and restores user list when Reset Filters is clicked', async () => {
    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    const searchInput = screen.getByLabelText(/search user accounts/i) as HTMLInputElement;
    const roleSelect = screen.getByLabelText(/^role:/i) as HTMLSelectElement;
    const statusSelect = screen.getByLabelText(/^status:/i) as HTMLSelectElement;

    // Apply all three filters
    fireEvent.change(searchInput, { target: { value: 'Manager' } });
    fireEvent.change(roleSelect, { target: { value: 'EMPLOYEE' } });
    fireEvent.change(statusSelect, { target: { value: 'DISABLED' } });

    // Contextual empty state appears
    expect(
      await screen.findByText(/User accounts exist, but none match the current search or filter criteria\./i)
    ).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /reset filters/i });
    fireEvent.click(resetBtn);

    // All filters are reset
    expect(searchInput.value).toBe('');
    expect(roleSelect.value).toBe('ALL');
    expect(statusSelect.value).toBe('ALL');

    // Users reappear in table
    expect(await screen.findByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('Marcus Manager')).toBeInTheDocument();
    expect(screen.getByText('Edward Employee')).toBeInTheDocument();
  });

  it('preserves genuine empty state when no user accounts exist in system', async () => {
    vi.spyOn(userManagementApi, 'getUsers').mockResolvedValue([]);

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    expect(
      await screen.findByText('No user accounts found matching current criteria.')
    ).toBeInTheDocument();

    // Reset filters button should NOT appear when there are genuinely 0 accounts
    expect(screen.queryByRole('button', { name: /reset filters/i })).not.toBeInTheDocument();

    // Total Accounts metric is 0
    const cards = document.querySelectorAll('.metric-card');
    const totalCard = Array.from(cards).find((c) => c.textContent?.includes('Total Accounts'));
    expect(totalCard?.querySelector('.metric-value')?.textContent).toBe('0');
  });

  it('displays distinct status indicators for active, inactive employee, and disabled accounts', async () => {
    const mixedUsers: UserAccount[] = [
      {
        id: 1,
        employee_id: null,
        full_name: 'Admin User',
        email: 'admin@example.com',
        role: 'ADMIN',
        is_active: true,
        employee_is_active: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        employee_id: 10,
        full_name: 'Active Staff',
        email: 'active@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: true,
        employee_code: 'EMP-ACT',
        department: 'Engineering',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 3,
        employee_id: 20,
        full_name: 'Inactive Emp Staff',
        email: 'inact.emp@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: false,
        employee_code: 'EMP-INA',
        department: 'Sales',
        created_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
      },
      {
        id: 4,
        employee_id: 30,
        full_name: 'Disabled User Staff',
        email: 'disabled@example.com',
        role: 'EMPLOYEE',
        is_active: false,
        employee_is_active: true,
        employee_code: 'EMP-DIS',
        department: 'Operations',
        created_at: '2026-01-04T00:00:00Z',
        updated_at: '2026-01-04T00:00:00Z',
      },
    ];

    vi.spyOn(userManagementApi, 'getUsers').mockResolvedValue(mixedUsers);

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    // 1. Active & eligible accounts show Active pill
    const activeRow = screen.getByText('Active Staff').closest('tr');
    expect(activeRow?.querySelector('.status-pill-present')).toHaveTextContent('Active');

    // 2. Inactive employee accounts show Inactive Employee pill
    const inactEmpRow = screen.getByText('Inactive Emp Staff').closest('tr');
    expect(inactEmpRow?.querySelector('.status-pill-warning')).toHaveTextContent('Inactive Employee');
    expect(inactEmpRow?.querySelector('.status-pill-warning')).toHaveAttribute(
      'title',
      'Linked employee record is inactive or deleted'
    );

    // 3. Independently disabled accounts show Disabled pill
    const disRow = screen.getByText('Disabled User Staff').closest('tr');
    expect(disRow?.querySelector('.status-pill-absent')).toHaveTextContent('Disabled');
  });

  it('updates summary metrics to reflect effective access eligibility with inactive employees', async () => {
    const mixedUsers: UserAccount[] = [
      {
        id: 1,
        employee_id: null,
        full_name: 'Admin User',
        email: 'admin@example.com',
        role: 'ADMIN',
        is_active: true,
        employee_is_active: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        employee_id: 10,
        full_name: 'Active Staff',
        email: 'active@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: true,
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 3,
        employee_id: 20,
        full_name: 'Inactive Emp Staff',
        email: 'inact.emp@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: false,
        created_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
      },
      {
        id: 4,
        employee_id: 30,
        full_name: 'Disabled User Staff',
        email: 'disabled@example.com',
        role: 'EMPLOYEE',
        is_active: false,
        employee_is_active: true,
        created_at: '2026-01-04T00:00:00Z',
        updated_at: '2026-01-04T00:00:00Z',
      },
    ];

    vi.spyOn(userManagementApi, 'getUsers').mockResolvedValue(mixedUsers);

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    const cards = document.querySelectorAll('.metric-card');
    const metricMap: Record<string, number> = {};
    cards.forEach((card) => {
      const label = card.querySelector('.metric-label')?.textContent?.trim() || '';
      const value = parseInt(card.querySelector('.metric-value')?.textContent?.trim() || '0', 10);
      metricMap[label] = value;
    });

    expect(metricMap['Total Accounts']).toBe(4);
    expect(metricMap['Active Accounts']).toBe(2); // Admin (standalone) + Active Staff
    expect(metricMap['Disabled Accounts']).toBe(1); // Disabled User Staff
    expect(metricMap['Inactive Employees']).toBe(1); // Inactive Emp Staff
    expect(metricMap['Administrators']).toBe(1);
    expect(metricMap['Employees']).toBe(3);

    // Reconcile status counts: Active (eligible) + Disabled + Inactive Employees === Total Accounts
    expect(
      metricMap['Active Accounts'] + metricMap['Disabled Accounts'] + metricMap['Inactive Employees']
    ).toBe(metricMap['Total Accounts']);

    // Reconcile role counts: Administrators + Managers + Employees === Total Accounts
    expect(
      metricMap['Administrators'] + (metricMap['Managers'] || 0) + metricMap['Employees']
    ).toBe(metricMap['Total Accounts']);
  });

  it('filters accurately by effective status: Active, Inactive Employee, and Disabled', async () => {
    const mixedUsers: UserAccount[] = [
      {
        id: 1,
        employee_id: null,
        full_name: 'Admin User',
        email: 'admin@example.com',
        role: 'ADMIN',
        is_active: true,
        employee_is_active: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        employee_id: 10,
        full_name: 'Active Staff',
        email: 'active@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: true,
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 3,
        employee_id: 20,
        full_name: 'Inactive Emp Staff',
        email: 'inact.emp@example.com',
        role: 'EMPLOYEE',
        is_active: true,
        employee_is_active: false,
        created_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
      },
      {
        id: 4,
        employee_id: 30,
        full_name: 'Disabled User Staff',
        email: 'disabled@example.com',
        role: 'EMPLOYEE',
        is_active: false,
        employee_is_active: true,
        created_at: '2026-01-04T00:00:00Z',
        updated_at: '2026-01-04T00:00:00Z',
      },
    ];

    vi.spyOn(userManagementApi, 'getUsers').mockResolvedValue(mixedUsers);

    render(<UserManagementView currentUser={mockAdmin} sessionEpoch={1} />);

    await screen.findByText('Admin User');

    const statusSelect = screen.getByLabelText(/^status:/i) as HTMLSelectElement;

    // 1. Filter by ACTIVE: Shows only Admin and Active Staff (excludes Inactive Employee and Disabled)
    fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('Active Staff')).toBeInTheDocument();
    expect(screen.queryByText('Inactive Emp Staff')).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled User Staff')).not.toBeInTheDocument();

    // 2. Filter by INACTIVE_EMPLOYEE: Shows only Inactive Emp Staff
    fireEvent.change(statusSelect, { target: { value: 'INACTIVE_EMPLOYEE' } });
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    expect(screen.queryByText('Active Staff')).not.toBeInTheDocument();
    expect(screen.getByText('Inactive Emp Staff')).toBeInTheDocument();
    expect(screen.queryByText('Disabled User Staff')).not.toBeInTheDocument();

    // 3. Filter by DISABLED: Shows only Disabled User Staff
    fireEvent.change(statusSelect, { target: { value: 'DISABLED' } });
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    expect(screen.queryByText('Active Staff')).not.toBeInTheDocument();
    expect(screen.queryByText('Inactive Emp Staff')).not.toBeInTheDocument();
    expect(screen.getByText('Disabled User Staff')).toBeInTheDocument();

    // 4. Return to ALL: Shows all users
    fireEvent.change(statusSelect, { target: { value: 'ALL' } });
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('Active Staff')).toBeInTheDocument();
    expect(screen.getByText('Inactive Emp Staff')).toBeInTheDocument();
    expect(screen.getByText('Disabled User Staff')).toBeInTheDocument();
  });
});
