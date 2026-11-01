import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeTable } from './EmployeeTable';
import { mockEmployee1, mockEmployee2, mockEmployeesList } from '../test/fixtures/employeeFixtures';

describe('EmployeeTable component', () => {
  const mockOnEdit = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnClearFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state when isLoading is true', () => {
    render(
      <EmployeeTable
        employees={[]}
        isLoading={true}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByRole('progressbar', { name: /loading employees/i })).toBeInTheDocument();
    expect(screen.getByText(/loading employee records\.\.\./i)).toBeInTheDocument();
  });

  it('renders empty state when there are zero employees and no active filter', () => {
    render(
      <EmployeeTable
        employees={[]}
        isLoading={false}
        totalCount={0}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('No Employees Found')).toBeInTheDocument();
    expect(screen.getByText(/get started by adding your first employee/i)).toBeInTheDocument();
  });

  it('renders filtered empty state with "Clear Filters" button when totalCount > 0', async () => {
    const user = userEvent.setup();
    render(
      <EmployeeTable
        employees={[]}
        isLoading={false}
        totalCount={5}
        onClearFilters={mockOnClearFilters}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText('No Matching Employees')).toBeInTheDocument();
    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);
    expect(mockOnClearFilters).toHaveBeenCalledTimes(1);
  });

  it('renders table headers and employee rows with active and inactive status badges', () => {
    render(
      <EmployeeTable
        employees={mockEmployeesList}
        isLoading={false}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByRole('columnheader', { name: /employee code|employee id/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /employee name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /department/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /designation/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument();

    // Check Employee 1 (Active)
    expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();
    expect(screen.getByText(`${mockEmployee1.first_name} ${mockEmployee1.last_name}`)).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.email)).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBe(2);

    // Check Employee 2 (Inactive)
    expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders BOTH Edit and Delete buttons when canDeactivate is true (ADMIN)', async () => {
    const user = userEvent.setup();
    render(
      <EmployeeTable
        employees={[mockEmployee1]}
        isLoading={false}
        canDeactivate={true}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    const editBtn = screen.getByRole('button', { name: new RegExp(`edit ${mockEmployee1.first_name}`, 'i') });
    const deleteBtn = screen.getByRole('button', { name: new RegExp(`delete ${mockEmployee1.first_name}`, 'i') });

    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();

    await user.click(editBtn);
    expect(mockOnEdit).toHaveBeenCalledWith(mockEmployee1);

    await user.click(deleteBtn);
    expect(mockOnDelete).toHaveBeenCalledWith(mockEmployee1);
  });

  it('renders Edit button but OMITS Delete button when canDeactivate is false (MANAGER)', () => {
    render(
      <EmployeeTable
        employees={[mockEmployee1]}
        isLoading={false}
        canDeactivate={false}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    const editBtn = screen.getByRole('button', { name: new RegExp(`edit ${mockEmployee1.first_name}`, 'i') });
    expect(editBtn).toBeInTheDocument();

    const deleteBtn = screen.queryByRole('button', { name: new RegExp(`delete ${mockEmployee1.first_name}`, 'i') });
    expect(deleteBtn).not.toBeInTheDocument();
  });
});
