import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteModal } from './DeleteModal';
import { mockEmployee1 } from '../test/fixtures/employeeFixtures';

describe('DeleteModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <DeleteModal
        isOpen={false}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders confirmation dialog with employee name, employee code, and warning', () => {
    render(
      <DeleteModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.getByRole('dialog', { name: /confirm deletion/i })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${mockEmployee1.first_name} ${mockEmployee1.last_name}`, 'i'))
    ).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();
    expect(
      screen.getByText(/this action removes the employee record from the database/i)
    ).toBeInTheDocument();
  });

  it('calls onClose when Cancel or close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DeleteModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('calls onConfirm when Delete button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DeleteModal
        isOpen={true}
        employee={mockEmployee1}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: /delete employee/i }));
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables buttons and shows "Deleting..." when isDeleting is true', () => {
    render(
      <DeleteModal
        isOpen={true}
        employee={mockEmployee1}
        isDeleting={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /deleting\.\.\./i });
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });

    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('aria-busy', 'true');
    expect(cancelBtn).toBeDisabled();
  });
});

