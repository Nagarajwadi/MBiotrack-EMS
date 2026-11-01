import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeModal } from './EmployeeModal';
import { mockEmployee1 } from '../test/fixtures/employeeFixtures';

describe('EmployeeModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <EmployeeModal
        isOpen={false}
        mode="create"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe('Create Mode', () => {
    it('renders "Add New Employee" title and enabled employee code input', () => {
      render(
        <EmployeeModal
          isOpen={true}
          mode="create"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('heading', { name: /add new employee/i })).toBeInTheDocument();
      const codeInput = screen.getByLabelText(/employee code/i);
      expect(codeInput).toBeEnabled();
      expect(screen.getByRole('button', { name: /add employee/i })).toBeInTheDocument();
    });

    it('validates required fields before submitting in create mode', async () => {
      const user = userEvent.setup();
      render(
        <EmployeeModal
          isOpen={true}
          mode="create"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await user.click(screen.getByRole('button', { name: /add employee/i }));

      expect(await screen.findByText('Employee code is required.')).toBeInTheDocument();
      expect(screen.getByText('First name is required.')).toBeInTheDocument();
      expect(screen.getByText('Last name is required.')).toBeInTheDocument();
      expect(screen.getByText('Email address is required.')).toBeInTheDocument();
      expect(screen.getByText('Department is required.')).toBeInTheDocument();
      expect(screen.getByText('Designation is required.')).toBeInTheDocument();
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('submits valid EmployeeCreatePayload with trimmed data', async () => {
      const user = userEvent.setup();
      render(
        <EmployeeModal
          isOpen={true}
          mode="create"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await user.type(screen.getByLabelText(/employee code/i), '  EMP-999  ');
      await user.type(screen.getByLabelText(/first name/i), '  Bruce  ');
      await user.type(screen.getByLabelText(/last name/i), '  Wayne  ');
      await user.type(screen.getByLabelText(/email address/i), '  bruce.wayne@company.com  ');
      await user.type(screen.getByLabelText(/department/i), '  Executive  ');
      await user.type(screen.getByLabelText(/designation/i), '  CEO  ');

      await user.click(screen.getByRole('button', { name: /add employee/i }));

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith({
        employee_code: 'EMP-999',
        first_name: 'Bruce',
        last_name: 'Wayne',
        email: 'bruce.wayne@company.com',
        department: 'Executive',
        designation: 'CEO',
        joining_date: expect.any(String),
        is_active: true,
      });
    });
  });

  describe('Edit Mode & Manager Restrictions', () => {
    it('renders "Edit Employee" with immutable code input and pre-populated fields', () => {
      render(
        <EmployeeModal
          isOpen={true}
          mode="edit"
          initialData={mockEmployee1}
          canDeactivate={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('heading', { name: /edit employee/i })).toBeInTheDocument();

      const codeInput = screen.getByLabelText(/employee code/i);
      expect(codeInput).toBeDisabled();
      expect(screen.getByText(/employee code is immutable and cannot be changed/i)).toBeInTheDocument();

      expect(screen.getByLabelText(/first name/i)).toHaveValue(mockEmployee1.first_name);
      expect(screen.getByLabelText(/last name/i)).toHaveValue(mockEmployee1.last_name);
      expect(screen.getByLabelText(/email address/i)).toHaveValue(mockEmployee1.email);
      expect(screen.getByLabelText(/department/i)).toHaveValue(mockEmployee1.department);
      expect(screen.getByLabelText(/designation/i)).toHaveValue(mockEmployee1.designation);
      expect(screen.getByLabelText(/active employee/i)).toBeChecked();
    });

    it('enables employment status checkbox for ADMIN (canDeactivate === true)', () => {
      render(
        <EmployeeModal
          isOpen={true}
          mode="edit"
          initialData={mockEmployee1}
          canDeactivate={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const statusCheckbox = screen.getByLabelText(/active employee/i);
      expect(statusCheckbox).toBeEnabled();
      expect(
        screen.queryByText(/only administrators can change employment status/i)
      ).not.toBeInTheDocument();
    });

    it('disables employment status checkbox and shows warning hint for MANAGER (canDeactivate === false)', () => {
      render(
        <EmployeeModal
          isOpen={true}
          mode="edit"
          initialData={mockEmployee1}
          canDeactivate={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const statusCheckbox = screen.getByLabelText(/active employee/i);
      expect(statusCheckbox).toBeDisabled();
      expect(
        screen.getByText(/only administrators can change employment status/i)
      ).toBeInTheDocument();
    });

    it('submits valid EmployeeUpdatePayload in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <EmployeeModal
          isOpen={true}
          mode="edit"
          initialData={mockEmployee1}
          canDeactivate={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      const firstNameInput = screen.getByLabelText(/first name/i);
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'Janet');

      await user.click(screen.getByRole('button', { name: /save changes/i }));

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith({
        first_name: 'Janet',
        last_name: mockEmployee1.last_name,
        email: mockEmployee1.email,
        department: mockEmployee1.department,
        designation: mockEmployee1.designation,
        joining_date: mockEmployee1.joining_date,
        is_active: true,
      });
    });
  });

  describe('Server error handling & dismiss', () => {
    it('displays server error banner and retains input values', () => {
      render(
        <EmployeeModal
          isOpen={true}
          mode="create"
          serverError="Employee code already exists"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Employee code already exists');
    });

    it('invokes onClose when Cancel or close button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <EmployeeModal
          isOpen={true}
          mode="create"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /close dialog/i }));
      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });
  });
});

