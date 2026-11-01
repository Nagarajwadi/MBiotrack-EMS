import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileEditModal } from './ProfileEditModal';
import { mockEmployee1 } from '../test/fixtures/employeeFixtures';

describe('ProfileEditModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ProfileEditModal
        isOpen={false}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal dialog with accessible title and read-only notice', () => {
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByRole('dialog', { name: /edit personal details/i })).toBeInTheDocument();
    expect(
      screen.getByText(/work email and organizational assignments are managed by hr/i)
    ).toBeInTheDocument();
  });

  it('renders organizational and email fields as disabled read-only inputs', () => {
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const codeInput = screen.getByLabelText(/employee code/i);
    const emailInput = screen.getByLabelText(/work email/i);
    const deptInput = screen.getByLabelText(/department/i);
    const desigInput = screen.getByLabelText(/designation/i);

    expect(codeInput).toBeDisabled();
    expect(codeInput).toHaveValue(mockEmployee1.employee_code);

    expect(emailInput).toBeDisabled();
    expect(emailInput).toHaveValue(mockEmployee1.email);

    expect(deptInput).toBeDisabled();
    expect(deptInput).toHaveValue(mockEmployee1.department);

    expect(desigInput).toBeDisabled();
    expect(desigInput).toHaveValue(mockEmployee1.designation);
  });

  it('populates editable first_name and last_name inputs', () => {
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);

    expect(firstNameInput).toBeEnabled();
    expect(firstNameInput).toHaveValue(mockEmployee1.first_name);

    expect(lastNameInput).toBeEnabled();
    expect(lastNameInput).toHaveValue(mockEmployee1.last_name);
  });

  it('validates required first and last name fields before submitting', async () => {
    const user = userEvent.setup();
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitBtn = screen.getByRole('button', { name: /save changes/i });

    await user.clear(firstNameInput);
    await user.click(submitBtn);

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();

    await user.type(firstNameInput, 'Jane');
    await user.clear(lastNameInput);
    await user.click(submitBtn);

    expect(await screen.findByText('Last name is required.')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits exact payload containing ONLY first_name and last_name', async () => {
    const user = userEvent.setup();
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const submitBtn = screen.getByRole('button', { name: /save changes/i });

    await user.clear(firstNameInput);
    await user.type(firstNameInput, '  Janet  ');
    await user.clear(lastNameInput);
    await user.type(lastNameInput, '  Doe-Smith  ');

    await user.click(submitBtn);

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).toHaveBeenCalledWith({
      first_name: 'Janet',
      last_name: 'Doe-Smith',
    });
    // Explicit assertion: payload must NOT include any other field
    const submittedPayload = mockOnSubmit.mock.calls[0][0];
    expect(Object.keys(submittedPayload).sort()).toEqual(['first_name', 'last_name']);
  });

  it('displays server error banner and preserves entered inputs on failed update', async () => {
    const { rerender } = render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        serverError={null}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const firstNameInput = screen.getByLabelText(/first name/i);
    const user = userEvent.setup();
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'CustomName');

    // Rerender with serverError prop (as parent does when submission fails)
    rerender(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        serverError="Backend error: Name contains invalid characters."
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Backend error: Name contains invalid characters.'
    );
    // User's typed value is preserved
    expect(screen.getByLabelText(/first name/i)).toHaveValue('CustomName');
  });

  it('calls onClose when Cancel or close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProfileEditModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close modal/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });
});

