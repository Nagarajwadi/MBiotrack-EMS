import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PunchModal } from './PunchModal';
import * as deviceApi from '../api/deviceApi';
import * as employeeApi from '../api/employeeApi';
import { mockEmployeeUser, mockAdminUser } from '../test/fixtures/authFixtures';
import type { Device } from '../types/device';
import type { Employee } from '../types/employee';

describe('PunchModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const sampleDevices: Device[] = [
    {
      id: 1,
      office_id: 1,
      name: 'Main Entrance Terminal',
      device_code: 'DEV-HQ-01',
      serial_number: 'SN-001',
      model_name: 'BioStation 3',
      ip_address: '192.168.1.100',
      mac_address: '00:11:22:33:44:55',
      status: 'ACTIVE',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      office_id: 1,
      name: 'North Wing Gate',
      device_code: 'DEV-HQ-02',
      serial_number: 'SN-002',
      model_name: 'FaceStation 2',
      ip_address: '192.168.1.101',
      mac_address: '00:11:22:33:44:56',
      status: 'ACTIVE',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleEmployees: Employee[] = [
    {
      id: 10,
      employee_code: 'testEmp01',
      first_name: 'Test',
      last_name: 'Employee',
      email: 'testemp01@example.com',
      department: 'Engineering',
      designation: 'Software Engineer',
      joining_date: '2026-01-01',
      is_active: true,
    },
    {
      id: 20,
      employee_code: 'testEmp02',
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'janesmith@example.com',
      department: 'Marketing',
      designation: 'Marketing Lead',
      joining_date: '2026-02-01',
      is_active: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(deviceApi, 'getDevices').mockResolvedValue(sampleDevices);
    vi.spyOn(employeeApi, 'getEmployees').mockResolvedValue(sampleEmployees);
  });

  it('renders modal dialog with accessible title and active devices', async () => {
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /check in confirmation/i })).toBeInTheDocument();
    expect(screen.getByText(mockEmployeeUser.full_name)).toBeInTheDocument();

    await waitFor(() => {
      expect(deviceApi.getDevices).toHaveBeenCalledWith({ active_only: true });
    });

    const select = screen.getByLabelText(/biometric terminal device/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /main entrance terminal/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /north wing gate/i })).toBeInTheDocument();
  });

  it('submits valid CHECK_IN punch payload when confirmed', async () => {
    const user = userEvent.setup();
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /main entrance terminal/i })).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
    await user.click(submitBtn);

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    const [payload] = mockOnSubmit.mock.calls[0];
    expect(payload.device_id).toBe(1);
    expect(payload.punch_type).toBe('CHECK_IN');
    expect(payload.idempotency_key).toBeDefined();
  });

  it('allows switching punch type to CHECK_OUT and changing device', async () => {
    const user = userEvent.setup();
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /north wing gate/i })).toBeInTheDocument();
    });

    // Select Check Out radio
    const checkOutRadio = screen.getByRole('radio', { name: /check out/i });
    await user.click(checkOutRadio);

    // Switch device
    const select = screen.getByLabelText(/biometric terminal device/i);
    await user.selectOptions(select, '2');

    const submitBtn = screen.getByRole('button', { name: /confirm check out/i });
    await user.click(submitBtn);

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: 2,
        punch_type: 'CHECK_OUT',
      })
    );
  });

  it('allows ADMIN to punch for a specific employee ID', async () => {
    const user = userEvent.setup();
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockAdminUser}
        targetEmployeeId={42}
        targetEmployeeName="Target Staff"
        defaultPunchType="CHECK_IN"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByText('Target Staff')).toBeInTheDocument();
    expect(screen.getByText(/(ID: #42)/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /main entrance terminal/i })).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
    await user.click(submitBtn);

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: 42,
        device_id: 1,
        punch_type: 'CHECK_IN',
      })
    );
  });

  it('disables submit button and shows loading state when isSubmitting is true (duplicate prevention)', () => {
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        isSubmitting={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /recording punch\.\.\./i });
    expect(submitBtn).toBeDisabled();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(cancelBtn).toBeDisabled();

    const closeBtn = screen.getByLabelText(/close modal/i);
    expect(closeBtn).toBeDisabled();
  });

  it('displays server error in an alert banner', () => {
    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        serverError="Terminal device is currently offline."
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Terminal device is currently offline.')).toBeInTheDocument();
  });

  it('displays error and disables submit when no active devices exist', async () => {
    vi.spyOn(deviceApi, 'getDevices').mockResolvedValueOnce([]);

    render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        defaultPunchType="CHECK_IN"
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no active biometric terminal devices are available/i)
      ).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
    expect(submitBtn).toBeDisabled();
  });

  it('calls onClose when Cancel button or Close icon is clicked', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    rerender(
      <PunchModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const closeBtn = screen.getByLabelText(/close modal/i);
    await user.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  describe('Admin/Manager Manual Punch Employee Selection', () => {
    it('renders employee dropdown with formatted options and loads active employees for admin manual punch', async () => {
      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(employeeApi.getEmployees).toHaveBeenCalledWith('ACTIVE');
      });

      const select = screen.getByLabelText(/target employee/i);
      expect(select).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /select an employee\.\.\./i })).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: /test employee \(testemp01\) — engineering/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: /jane smith \(testemp02\) — marketing/i })
      ).toBeInTheDocument();
    });

    it('submits selected integer employee_id when an employee is chosen from dropdown', async () => {
      const user = userEvent.setup();
      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('option', { name: /test employee \(testemp01\) — engineering/i })
        ).toBeInTheDocument();
      });

      const employeeSelect = screen.getByLabelText(/target employee/i);
      await user.selectOptions(employeeSelect, '10');

      const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
      expect(submitBtn).toBeEnabled();
      await user.click(submitBtn);

      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 10,
          punch_type: 'CHECK_IN',
          device_id: 1,
        })
      );
    });

    it('disables submit button until an employee is selected from the dropdown', async () => {
      const user = userEvent.setup();
      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByRole('option', { name: /test employee \(testemp01\) — engineering/i })
        ).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
      expect(submitBtn).toBeDisabled();

      const employeeSelect = screen.getByLabelText(/target employee/i);
      await user.selectOptions(employeeSelect, '20');

      expect(submitBtn).toBeEnabled();
    });

    it('displays loading state while active employees are loading', () => {
      vi.spyOn(employeeApi, 'getEmployees').mockReturnValueOnce(new Promise(() => {}));

      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByRole('status', { name: /loading active employees/i })).toBeInTheDocument();
      expect(screen.getByText(/loading active employees\.\.\./i)).toBeInTheDocument();
    });

    it('displays error state when employee loading fails', async () => {
      vi.spyOn(employeeApi, 'getEmployees').mockRejectedValueOnce(
        new Error('Failed to load employees')
      );

      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/unable to load active employees\./i)).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
      expect(submitBtn).toBeDisabled();
    });

    it('displays empty state when no active employees are available', async () => {
      vi.spyOn(employeeApi, 'getEmployees').mockResolvedValueOnce([]);

      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText(/no active employees are available\. please add an employee first\./i)
        ).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /confirm check in/i });
      expect(submitBtn).toBeDisabled();
    });

    it('uses prop employees directly without calling getEmployees when provided', () => {
      render(
        <PunchModal
          isOpen={true}
          currentUser={mockAdminUser}
          employees={sampleEmployees}
          defaultPunchType="CHECK_IN"
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
        />
      );

      expect(employeeApi.getEmployees).not.toHaveBeenCalled();
      expect(
        screen.getByRole('option', { name: /test employee \(testemp01\) — engineering/i })
      ).toBeInTheDocument();
    });
  });
});
