import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactivateModal } from './ReactivateModal';
import { mockEmployee2 } from '../test/fixtures/employeeFixtures';

describe('ReactivateModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ReactivateModal
        isOpen={false}
        employee={mockEmployee2}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders confirmation dialog with employee name, employee code, and restoration note', () => {
    render(
      <ReactivateModal
        isOpen={true}
        employee={mockEmployee2}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    expect(screen.getByRole('dialog', { name: /confirm reactivation/i })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${mockEmployee2.first_name} ${mockEmployee2.last_name}`, 'i'))
    ).toBeInTheDocument();
    expect(screen.getByText(mockEmployee2.employee_code)).toBeInTheDocument();
    expect(
      screen.getByText(/this will restore the employee to active employment status/i)
    ).toBeInTheDocument();
  });

  it('calls onClose when Cancel or close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ReactivateModal
        isOpen={true}
        employee={mockEmployee2}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('calls onConfirm when Reactivate button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ReactivateModal
        isOpen={true}
        employee={mockEmployee2}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    await user.click(screen.getByTestId('confirm-reactivate-btn'));
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables buttons and shows loading state when isReactivating is true', () => {
    render(
      <ReactivateModal
        isOpen={true}
        employee={mockEmployee2}
        isReactivating={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
      />
    );

    const reactivateBtn = screen.getByRole('button', { name: /reactivating\.\.\./i });
    expect(reactivateBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeDisabled();
  });
});
