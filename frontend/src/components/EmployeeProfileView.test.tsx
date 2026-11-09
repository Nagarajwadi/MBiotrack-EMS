import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeProfileView } from './EmployeeProfileView';
import * as employeeApi from '../api/employeeApi';
import * as authApi from '../api/authApi';
import { ApiError } from '../api/apiError';
import { mockEmployee1 } from '../test/fixtures/employeeFixtures';
import { mockEmployeeUser } from '../test/fixtures/authFixtures';

vi.mock('../api/employeeApi', () => ({
  getEmployee: vi.fn(),
  updateEmployee: vi.fn(),
}));

describe('EmployeeProfileView component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading spinner while profile request is in-flight', () => {
    vi.mocked(employeeApi.getEmployee).mockReturnValue(new Promise(() => {}));

    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    expect(screen.getByRole('progressbar', { name: /loading profile/i })).toBeInTheDocument();
    expect(screen.getByText(/loading personal profile\.\.\./i)).toBeInTheDocument();
  });

  it('loads and displays employee staff details accurately', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);

    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent(
      `${mockEmployee1.first_name} ${mockEmployee1.last_name}`
    );
    expect(screen.getByText(mockEmployee1.employee_code)).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.email)).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.department)).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.designation)).toBeInTheDocument();
    expect(screen.getByText(mockEmployee1.joining_date)).toBeInTheDocument();
    expect(screen.getByText('Active Staff')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('None assigned')).toBeInTheDocument();
    expect(screen.getByText(/contact & personal information/i)).toBeInTheDocument();
  });

  it('displays error banner and retry button when profile fetch fails with 404', async () => {
    vi.mocked(employeeApi.getEmployee).mockRejectedValueOnce(
      new ApiError(404, 'Employee record not found in system.')
    );

    render(<EmployeeProfileView employeeId={999} sessionEpoch={1} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Employee record not found in system.'
    );
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Clicking retry calls getEmployee again
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
    const user = userEvent.setup();
    await user.click(retryBtn);

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent(
      `${mockEmployee1.first_name} ${mockEmployee1.last_name}`
    );
  });

  it('displays error banner and retry button when profile fetch fails with 500 Internal Server Error', async () => {
    vi.mocked(employeeApi.getEmployee).mockRejectedValueOnce(
      new ApiError(500, 'Internal Server Error: database connection timeout.')
    );

    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Internal Server Error: database connection timeout.'
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('strictly prevents employee user from viewing another employee profile (authorization check)', () => {
    // mockEmployeeUser has employee_id = 3
    render(
      <EmployeeProfileView
        employeeId={99}
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Access forbidden: You may only view your own employee record.'
    );
    // Crucial security invariant: getEmployee is never called for unauthorized employee target
    expect(employeeApi.getEmployee).not.toHaveBeenCalled();
    // Non-retryable authorization failure has no retry button
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('allows employee user to view their own profile when IDs match', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);

    render(
      <EmployeeProfileView
        employeeId={mockEmployeeUser.employee_id!}
        currentUser={mockEmployeeUser}
        sessionEpoch={1}
      />
    );

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent(
      `${mockEmployee1.first_name} ${mockEmployee1.last_name}`
    );
    expect(employeeApi.getEmployee).toHaveBeenCalledWith(mockEmployeeUser.employee_id);
  });

  it('opens edit modal and successfully updates profile with only first_name and last_name', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
    const updatedEmployee = { ...mockEmployee1, first_name: 'Janet', last_name: 'Doe' };
    vi.mocked(employeeApi.updateEmployee).mockResolvedValueOnce(updatedEmployee);

    const mockOnUpdated = vi.fn();
    const user = userEvent.setup();

    render(
      <EmployeeProfileView
        employeeId={1}
        sessionEpoch={1}
        onProfileUpdated={mockOnUpdated}
      />
    );

    // Wait for initial load
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('Jane Doe');

    // Click "Edit Details"
    await user.click(screen.getByRole('button', { name: /edit details/i }));

    // Modal opens
    expect(screen.getByRole('dialog', { name: /edit personal details/i })).toBeInTheDocument();

    // Edit first_name
    const firstNameInput = screen.getByLabelText(/first name/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'Janet');

    // Submit modal
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // updateEmployee must be called with ONLY first_name and last_name
    await waitFor(() => {
      expect(employeeApi.updateEmployee).toHaveBeenCalledTimes(1);
    });
    expect(employeeApi.updateEmployee).toHaveBeenCalledWith(1, {
      first_name: 'Janet',
      last_name: 'Doe',
    });

    // Modal closes and profile card updates
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Janet Doe');
    expect(screen.getByText(/your personal details have been updated successfully/i)).toBeInTheDocument();
    expect(mockOnUpdated).toHaveBeenCalledWith(updatedEmployee);
  });

  it('allows user to cancel edit modal without saving changes', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);

    const user = userEvent.setup();
    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('Jane Doe');

    // Open edit modal
    await user.click(screen.getByRole('button', { name: /edit details/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Type change into first_name
    const firstNameInput = screen.getByLabelText(/first name/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'UnsavedName');

    // Click cancel
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Modal closes without saving
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(employeeApi.updateEmployee).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Jane Doe');
  });

  it('displays error banner when update fails with 403 Forbidden', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
    vi.mocked(employeeApi.updateEmployee).mockRejectedValueOnce(
      new ApiError(403, 'Employees are only permitted to update first_name and last_name.')
    );

    const user = userEvent.setup();
    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: /edit details/i }));

    // Submit modal
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // Expect server error alert inside modal
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Employees are only permitted to update first_name and last_name.'
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays error banner when update fails with 400 Bad Request', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
    vi.mocked(employeeApi.updateEmployee).mockRejectedValueOnce(
      new ApiError(400, 'Invalid name format or unsupported characters.')
    );

    const user = userEvent.setup();
    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: /edit details/i }));

    // Submit modal
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // Expect server error alert inside modal
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid name format or unsupported characters.'
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens change password modal when change password button is clicked', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);

    const user = userEvent.setup();
    render(<EmployeeProfileView employeeId={1} sessionEpoch={1} />);

    await screen.findByRole('heading', { level: 2 });
    const changePwdBtn = screen.getByRole('button', { name: /change password/i });
    expect(changePwdBtn).toBeInTheDocument();

    await user.click(changePwdBtn);
    expect(await screen.findByRole('dialog', { name: /change password/i })).toBeInTheDocument();
  });

  it('triggers onPasswordChanged callback upon successful password change', async () => {
    vi.mocked(employeeApi.getEmployee).mockResolvedValueOnce(mockEmployee1);
    const onPasswordChanged = vi.fn();

    const user = userEvent.setup();
    render(
      <EmployeeProfileView
        employeeId={1}
        sessionEpoch={1}
        onPasswordChanged={onPasswordChanged}
      />
    );

    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: /change password/i }));

    vi.spyOn(authApi, 'changePassword').mockResolvedValueOnce({
      message: 'Password changed successfully.',
    });

    await user.type(screen.getByLabelText(/Current Password/i), 'OldPass123456!');
    await user.type(screen.getByLabelText(/^New Password/i), 'ValidPass123456!');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'ValidPass123456!');

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    await waitFor(() => {
      expect(onPasswordChanged).toHaveBeenCalledWith('Password changed successfully.');
    });
  });
});
