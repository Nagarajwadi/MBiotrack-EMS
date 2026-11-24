import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as assignmentApi from '../api/assignmentApi';
import * as deviceApi from '../api/deviceApi';
import * as employeeApi from '../api/employeeApi';
import * as officeApi from '../api/officeApi';
import { mockAdminUser, mockManagerUser } from '../test/fixtures/authFixtures';
import type { OfficeAssignment } from '../types/assignment';
import type { Device } from '../types/device';
import type { Employee } from '../types/employee';
import type { Office } from '../types/office';
import { ManagementView } from './ManagementView';

describe('ManagementView component', () => {
  const sampleOffices: Office[] = [
    {
      id: 1,
      name: 'Headquarters',
      code: 'HQ',
      timezone: 'Asia/Kolkata',
      address: 'Floor 1, Building A',
      is_active: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 2,
      name: 'Branch West',
      code: 'BR-W',
      timezone: 'Asia/Kolkata',
      address: 'Plot 42, Sector 5',
      is_active: false,
      created_at: '2026-11-02T00:00:00Z',
      updated_at: '2026-11-02T00:00:00Z',
    },
  ];

  const sampleDevices: Device[] = [
    {
      id: 10,
      office_id: 1,
      name: 'Turnstile A',
      device_code: 'DEV-A',
      serial_number: 'SN-001',
      model_name: 'ZKTeco Pro',
      ip_address: '192.168.1.10',
      mac_address: '00:11:22:33:44:55',
      status: 'ACTIVE',
      is_active: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 20,
      office_id: 1,
      name: 'Backup Reader',
      device_code: 'DEV-BK',
      serial_number: 'SN-002',
      model_name: 'ZKTeco Mini',
      ip_address: '192.168.1.11',
      mac_address: null,
      status: 'INACTIVE',
      is_active: false,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 30,
      office_id: 2,
      name: 'Old Terminal',
      device_code: 'DEV-OLD',
      serial_number: 'SN-999',
      model_name: 'Legacy 100',
      ip_address: null,
      mac_address: null,
      status: 'DECOMMISSIONED',
      is_active: false,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-15T00:00:00Z',
    },
  ];

  const sampleAssignments: OfficeAssignment[] = [
    {
      id: 100,
      employee_id: 1,
      office_id: 1,
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: '2026-12-31T23:59:59Z',
      is_primary: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleEmployees: Employee[] = [
    {
      id: 1,
      employee_code: 'EMP-001',
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      department: 'Engineering',
      designation: 'Staff Engineer',
      joining_date: '2025-01-01',
      is_active: true,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(officeApi, 'getOffices').mockResolvedValue(sampleOffices);
    vi.spyOn(deviceApi, 'getDevices').mockResolvedValue(sampleDevices);
    vi.spyOn(assignmentApi, 'getAssignments').mockResolvedValue(sampleAssignments);
    vi.spyOn(employeeApi, 'getEmployees').mockResolvedValue(sampleEmployees);
  });

  it('renders loading state initially while fetching management entities', () => {
    vi.spyOn(officeApi, 'getOffices').mockImplementation(() => new Promise(() => {}));

    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    expect(screen.getByRole('progressbar', { name: /loading management data/i })).toBeInTheDocument();
  });

  it('renders Offices tab by default and allows ADMIN to open create office modal', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /offices, devices & assignments/i })).toBeInTheDocument();
    });

    // Office list
    expect(screen.getByText('Headquarters')).toBeInTheDocument();
    expect(screen.getByText('Branch West')).toBeInTheDocument();
    expect(screen.getByText('HQ')).toBeInTheDocument();

    // Admin has + Add Office
    const addBtn = screen.getByRole('button', { name: /\+ add office/i });
    expect(addBtn).toBeInTheDocument();

    await user.click(addBtn);

    expect(screen.getByRole('dialog', { name: /add new office/i })).toBeInTheDocument();
  });

  it('restricts office action buttons for MANAGER role', async () => {
    render(
      <ManagementView
        currentUser={mockManagerUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    // Manager can view offices but cannot add, edit, or deactivate
    expect(screen.queryByRole('button', { name: /\+ add office/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit office headquarters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deactivate office headquarters/i })).not.toBeInTheDocument();
  });

  it('switches to Devices tab, lists devices, and distinguishes ACTIVE, INACTIVE, and DECOMMISSIONED statuses', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    // Switch to Devices tab
    const devicesTab = screen.getByRole('tab', { name: /devices/i });
    await user.click(devicesTab);

    await waitFor(() => {
      expect(screen.getByText('Turnstile A')).toBeInTheDocument();
    });

    expect(screen.getByText('Backup Reader')).toBeInTheDocument();
    expect(screen.getByText('Old Terminal')).toBeInTheDocument();

    // Distinct badges
    const actBadge = screen.getByTestId('device-status-10');
    expect(actBadge).toHaveTextContent('ACTIVE');

    const inactBadge = screen.getByTestId('device-status-20');
    expect(inactBadge).toHaveTextContent('INACTIVE');

    const decomBadge = screen.getByTestId('device-status-30');
    expect(decomBadge).toHaveTextContent('DECOMMISSIONED');

    // Admin has Register Device button
    expect(screen.getByRole('button', { name: /\+ register device/i })).toBeInTheDocument();
  });

  it('filters devices by office and status select dropdowns', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    const devicesTab = screen.getByRole('tab', { name: /devices/i });
    await user.click(devicesTab);

    // Filter by status=ACTIVE
    const statusSelect = screen.getByLabelText(/filter devices by status/i);
    await user.selectOptions(statusSelect, 'ACTIVE');

    expect(screen.getByText('Turnstile A')).toBeInTheDocument();
    expect(screen.queryByText('Backup Reader')).not.toBeInTheDocument();
    expect(screen.queryByText('Old Terminal')).not.toBeInTheDocument();
  });

  it('opens Edit device modal with populated data and resets selection on modal close', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    const devicesTab = screen.getByRole('tab', { name: /devices/i });
    await user.click(devicesTab);

    await waitFor(() => {
      expect(screen.getByText('Turnstile A')).toBeInTheDocument();
    });

    // Click Edit on Turnstile A
    const editBtn = screen.getByRole('button', { name: /edit device turnstile a/i });
    await user.click(editBtn);

    // Modal opens in Edit mode with populated fields
    expect(screen.getByRole('heading', { name: /edit device/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Turnstile A');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('DEV-A');
    expect(screen.getByLabelText(/serial number/i)).toHaveValue('SN-001');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('ZKTeco Pro');

    // Close modal via Cancel button
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);

    expect(screen.queryByRole('heading', { name: /edit device/i })).not.toBeInTheDocument();

    // Reopen Edit on the same device (Turnstile A) and verify clean state
    await user.click(editBtn);
    expect(screen.getByRole('heading', { name: /edit device/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Turnstile A');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Now click Edit on Backup Reader (switching devices)
    const editBackupBtn = screen.getByRole('button', { name: /edit device backup reader/i });
    await user.click(editBackupBtn);

    expect(screen.getByRole('heading', { name: /edit device/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Backup Reader');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('DEV-BK');
    expect(screen.getByLabelText(/serial number/i)).toHaveValue('SN-002');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('ZKTeco Mini');
    expect(screen.getByLabelText(/device lifecycle status/i)).toHaveValue('INACTIVE');
  });

  it('opens Register Device modal with blank text fields and default office', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    const devicesTab = screen.getByRole('tab', { name: /devices/i });
    await user.click(devicesTab);

    await waitFor(() => {
      expect(screen.getByText('Turnstile A')).toBeInTheDocument();
    });

    const registerBtn = screen.getByRole('button', { name: /\+ register device/i });
    await user.click(registerBtn);

    expect(screen.getByRole('heading', { name: /register new device/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/assigned office location/i)).toHaveValue('1');
    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('');
    expect(screen.getByLabelText(/serial number/i)).toHaveValue('');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('');
    expect(screen.getByLabelText(/ip address/i)).toHaveValue('');
    expect(screen.getByLabelText(/mac address/i)).toHaveValue('');
    expect(screen.getByLabelText(/device lifecycle status/i)).toHaveValue('ACTIVE');
    expect(screen.getByLabelText(/active terminal/i)).toBeChecked();

    // Close modal via Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelBtn);
    expect(screen.queryByRole('heading', { name: /register new device/i })).not.toBeInTheDocument();
  });

  it('switches to Assignments tab and displays employee assignments with date ranges and primary status', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    // Switch to Assignments tab
    const assignTab = screen.getByRole('tab', { name: /office assignments/i });
    await user.click(assignTab);

    await waitFor(() => {
      expect(screen.getByText(/alice smith/i)).toBeInTheDocument();
    });

    expect(screen.getByText('PRIMARY')).toBeInTheDocument();

    // Admin can delete assignment
    expect(screen.getByRole('button', { name: /delete assignment #100/i })).toBeInTheDocument();
  });

  it('allows MANAGER to create assignment but omits delete assignment button', async () => {
    const user = userEvent.setup();
    render(
      <ManagementView
        currentUser={mockManagerUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Headquarters')).toBeInTheDocument();
    });

    const assignTab = screen.getByRole('tab', { name: /office assignments/i });
    await user.click(assignTab);

    await waitFor(() => {
      expect(screen.getByText(/alice smith/i)).toBeInTheDocument();
    });

    // Manager can create assignment
    const createBtn = screen.getByRole('button', { name: /\+ create assignment/i });
    expect(createBtn).toBeInTheDocument();

    // But cannot delete assignment
    expect(screen.queryByRole('button', { name: /delete assignment #100/i })).not.toBeInTheDocument();

    await user.click(createBtn);
    expect(screen.getByRole('dialog', { name: /create office assignment/i })).toBeInTheDocument();
  });

  it('displays error banner and retry button when data loading fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(officeApi, 'getOffices').mockRejectedValueOnce(new Error('Network service unreachable'));

    render(
      <ManagementView
        currentUser={mockAdminUser}
        sessionEpoch={1}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Network service unreachable')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    vi.spyOn(officeApi, 'getOffices').mockResolvedValueOnce(sampleOffices);
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Headquarters')).toBeInTheDocument();
  });
});
