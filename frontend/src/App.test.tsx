import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as employeeApi from './api/employeeApi';
import { renderWithAuth } from './test/renderUtils';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
  mockUnlinkedAdminUser,
  mockUnlinkedEmployeeUser,
} from './test/fixtures/authFixtures';
import {
  mockCreatedEmployee,
  mockEmployee1,
  mockEmployee2,
  mockEmployeesList,
} from './test/fixtures/employeeFixtures';

vi.mock('./api/employeeApi', () => ({
  getHealth: vi.fn(),
  getEmployees: vi.fn(),
  getEmployee: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
}));

describe('App component role-based access & directory UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(employeeApi.getHealth).mockResolvedValue({
      status: 'ok',
      application: 'mbiotrack-backend',
    });
  });

  it('renders LoginForm when user is unauthenticated', () => {
    renderWithAuth(<App />, { user: null });

    expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /employee directory/i })).not.toBeInTheDocument();
  });

  describe('ADMIN role UI behavior', () => {
    it('renders full employee directory, summary metrics, and "+ Add Employee" button', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);

      renderWithAuth(<App />, { user: mockAdminUser });

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ add employee/i })).toBeInTheDocument();

      // Summary metrics
      expect(screen.getByText('Total Employees')).toBeInTheDocument();
      expect(screen.getByText('Active Staff')).toBeInTheDocument();
      expect(screen.getByText('Inactive Staff')).toBeInTheDocument();

      // Employees table rendered with Delete action available
      expect(await screen.findByText(mockEmployee1.employee_code)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: new RegExp(`delete ${mockEmployee1.first_name}`, 'i') })
      ).toBeInTheDocument();
    });

    it('allows ADMIN to toggle between Employee Directory and My Profile when linked', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);
      vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
      const user = userEvent.setup();

      renderWithAuth(<App />, { user: mockAdminUser });

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();

      const profileTab = screen.getByRole('button', { name: /my profile/i });
      await user.click(profileTab);

      // Now personal profile view is rendered
      expect(await screen.findByRole('heading', { name: /jane doe/i })).toBeInTheDocument();
      expect(employeeApi.getEmployee).toHaveBeenCalledWith(mockAdminUser.employee_id);
    });

    it('OMITS "My Profile" tab when ADMIN is unlinked (employee_id === null)', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);

      renderWithAuth(<App />, { user: mockUnlinkedAdminUser });

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /my profile/i })).not.toBeInTheDocument();
      // Verifies no rogue API call to /employees/null
      expect(employeeApi.getEmployee).not.toHaveBeenCalled();
    });

    it('opens DeleteModal and deletes an employee as ADMIN', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValue(mockEmployeesList);
      vi.mocked(employeeApi.deleteEmployee).mockResolvedValueOnce(undefined);
      const user = userEvent.setup();

      renderWithAuth(<App />, { user: mockAdminUser });

      expect(await screen.findByText(mockEmployee1.employee_code)).toBeInTheDocument();

      // Click delete button on row
      const deleteRowBtn = screen.getByRole('button', {
        name: new RegExp(`delete ${mockEmployee1.first_name}`, 'i'),
      });
      await user.click(deleteRowBtn);

      // Delete confirmation modal appears
      expect(screen.getByRole('dialog', { name: /confirm deletion/i })).toBeInTheDocument();

      // Click "Delete Employee" inside modal
      await user.click(screen.getByRole('button', { name: /^delete employee$/i }));

      await waitFor(() => {
        expect(employeeApi.deleteEmployee).toHaveBeenCalledWith(mockEmployee1.id);
      });
    });

    it('opens create modal, submits new employee, and refreshes directory', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValue(mockEmployeesList);
      vi.mocked(employeeApi.createEmployee).mockResolvedValueOnce(mockCreatedEmployee);
      const user = userEvent.setup();

      renderWithAuth(<App />, { user: mockAdminUser });

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /\+ add employee/i }));

      const modal = screen.getByRole('dialog', { name: /add new employee/i });
      expect(modal).toBeInTheDocument();

      await user.type(within(modal).getByLabelText(/employee code/i), 'EMP-004');
      await user.type(within(modal).getByLabelText(/first name/i), 'Diana');
      await user.type(within(modal).getByLabelText(/last name/i), 'Prince');
      await user.type(within(modal).getByLabelText(/email address/i), 'diana.prince@company.com');
      await user.type(within(modal).getByLabelText(/department/i), 'Security');
      await user.type(within(modal).getByLabelText(/designation/i), 'Security Specialist');

      await user.click(within(modal).getByRole('button', { name: /^add employee$/i }));

      await waitFor(() => {
        expect(employeeApi.createEmployee).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('MANAGER role UI behavior', () => {
    it('renders directory and Add Employee button, but OMITS Delete buttons', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);

      renderWithAuth(<App />, { user: mockManagerUser });

      expect(await screen.findByRole('heading', { name: /employee directory/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ add employee/i })).toBeInTheDocument();

      // Edit button is rendered
      expect(
        screen.getByRole('button', { name: new RegExp(`edit ${mockEmployee1.first_name}`, 'i') })
      ).toBeInTheDocument();

      // Delete button is strictly absent for Manager
      expect(
        screen.queryByRole('button', { name: new RegExp(`delete ${mockEmployee1.first_name}`, 'i') })
      ).not.toBeInTheDocument();
    });

    it('disables employment status checkbox in edit modal for MANAGER', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce([mockEmployee1]);
      const user = userEvent.setup();

      renderWithAuth(<App />, { user: mockManagerUser });

      const editBtn = await screen.findByRole('button', {
        name: new RegExp(`edit ${mockEmployee1.first_name}`, 'i'),
      });
      await user.click(editBtn);

      expect(screen.getByRole('dialog', { name: /edit employee/i })).toBeInTheDocument();

      const activeCheckbox = screen.getByLabelText(/active employee/i);
      expect(activeCheckbox).toBeDisabled();
      expect(screen.getByText(/only administrators can change employment status/i)).toBeInTheDocument();
    });
  });

  describe('EMPLOYEE role UI behavior & API isolation', () => {
    it('strictly OMITS employee directory and never calls getEmployees()', async () => {
      vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);

      renderWithAuth(<App />, { user: mockEmployeeUser });

      // Verifies getEmployees is NEVER invoked
      expect(employeeApi.getEmployees).not.toHaveBeenCalled();

      // Directory elements are completely absent
      expect(screen.queryByRole('heading', { name: /employee directory/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /\+ add employee/i })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/search by code, name, email/i)).not.toBeInTheDocument();

      // Profile is displayed directly
      expect(await screen.findByRole('heading', { name: /jane doe/i })).toBeInTheDocument();
      expect(employeeApi.getEmployee).toHaveBeenCalledWith(mockEmployeeUser.employee_id);
    });

    it('renders unlinked account warning banner when EMPLOYEE employee_id is null', async () => {
      renderWithAuth(<App />, { user: mockUnlinkedEmployeeUser });

      expect(employeeApi.getEmployees).not.toHaveBeenCalled();
      expect(employeeApi.getEmployee).not.toHaveBeenCalled();

      expect(
        await screen.findByText(
          /your user account is not linked to an employee staff profile\. please contact an administrator/i
        )
      ).toBeInTheDocument();
    });
  });

  describe('Search and department filtering in directory', () => {
    it('filters rows by text search and department select', async () => {
      vi.mocked(employeeApi.getEmployees).mockResolvedValueOnce(mockEmployeesList);
      const user = userEvent.setup();

      renderWithAuth(<App />, { user: mockAdminUser });

      expect(await screen.findByText(mockEmployee1.employee_code)).toBeInTheDocument();
      expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();

      // Search by text
      const searchInput = screen.getByPlaceholderText(/search by code, name, email/i);
      await user.type(searchInput, 'Jane');

      expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();
      expect(screen.queryByText(mockEmployee2.employee_code)).not.toBeInTheDocument();

      // Clear search
      await user.clear(searchInput);
      expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();

      // Filter by department
      const deptSelect = screen.getByRole('combobox', { name: /filter by department/i });
      await user.selectOptions(deptSelect, 'Human Resources');

      expect(screen.queryByText(mockEmployee1.employee_code)).not.toBeInTheDocument();
      expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();

      // Clear filter button
      await user.click(screen.getByRole('button', { name: /clear filters/i }));
      expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();
    });
  });
});
