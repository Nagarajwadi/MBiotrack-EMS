import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceModal } from './DeviceModal';
import type { Device } from '../types/device';
import type { Office } from '../types/office';

describe('DeviceModal component', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const sampleOffices: Office[] = [
    {
      id: 1,
      name: 'Bengaluru Central',
      code: 'BLR-01',
      timezone: 'Asia/Kolkata',
      address: 'MG Road',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      name: 'Mumbai HQ',
      code: 'MUM-01',
      timezone: 'Asia/Kolkata',
      address: 'Nariman Point',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleDevice1: Device = {
    id: 10,
    office_id: 1,
    name: 'Main Lobby Turnstile',
    device_code: 'DEV-LOBBY-01',
    serial_number: 'SN-LOBBY-999',
    model_name: 'ZKTeco ProCapture',
    ip_address: '192.168.1.100',
    mac_address: '00:1A:2B:3C:4D:5E',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const sampleDevice2: Device = {
    id: 20,
    office_id: 2,
    name: 'Warehouse Gate 2',
    device_code: 'DEV-WH-02',
    serial_number: 'SN-WH-888',
    model_name: 'Suprema BioEntry',
    ip_address: '192.168.2.200',
    mac_address: '00:11:22:33:44:55',
    status: 'INACTIVE',
    is_active: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <DeviceModal
        isOpen={false}
        mode="create"
        offices={sampleOffices}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens Create mode with blank text fields and default office', () => {
    render(
      <DeviceModal
        key="create-device"
        isOpen={true}
        mode="create"
        offices={sampleOffices}
        initialData={null}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

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
  });

  it('opens Edit mode with fully populated device data', () => {
    render(
      <DeviceModal
        isOpen={true}
        mode="edit"
        offices={sampleOffices}
        initialData={sampleDevice1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByRole('heading', { name: /edit device/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/assigned office location/i)).toHaveValue('1');
    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Main Lobby Turnstile');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('DEV-LOBBY-01');
    expect(screen.getByLabelText(/serial number/i)).toHaveValue('SN-LOBBY-999');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('ZKTeco ProCapture');
    expect(screen.getByLabelText(/ip address/i)).toHaveValue('192.168.1.100');
    expect(screen.getByLabelText(/mac address/i)).toHaveValue('00:1A:2B:3C:4D:5E');
    expect(screen.getByLabelText(/device lifecycle status/i)).toHaveValue('ACTIVE');
    expect(screen.getByLabelText(/active terminal/i)).toBeChecked();
  });

  it('synchronizes office options when offices load after modal initialization', () => {
    const { rerender } = render(
      <DeviceModal
        isOpen={true}
        mode="create"
        offices={[]}
        initialData={null}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const officeSelect = screen.getByLabelText(/assigned office location/i);
    expect(officeSelect).toHaveValue('');

    // Offices finish loading
    rerender(
      <DeviceModal
        isOpen={true}
        mode="create"
        offices={sampleOffices}
        initialData={null}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByLabelText(/assigned office location/i)).toHaveValue('1');
    expect(screen.getByRole('option', { name: /bengaluru central/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /mumbai hq/i })).toBeInTheDocument();
  });

  it('discards unsaved modifications when closing and reopening the modal', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DeviceModal
        isOpen={true}
        mode="edit"
        offices={sampleOffices}
        initialData={sampleDevice1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const nameInput = screen.getByLabelText(/device descriptive name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Dirty Unsaved Name');
    expect(nameInput).toHaveValue('Dirty Unsaved Name');

    // Close modal
    rerender(
      <DeviceModal
        isOpen={false}
        mode="create"
        offices={sampleOffices}
        initialData={null}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    // Reopen edit modal with original device
    rerender(
      <DeviceModal
        key={`edit-device-${sampleDevice1.id}-reopened`}
        isOpen={true}
        mode="edit"
        offices={sampleOffices}
        initialData={sampleDevice1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Main Lobby Turnstile');
  });

  it('switches between different devices without retaining stale form values', () => {
    const { rerender } = render(
      <DeviceModal
        key={`edit-device-${sampleDevice1.id}`}
        isOpen={true}
        mode="edit"
        offices={sampleOffices}
        initialData={sampleDevice1}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Main Lobby Turnstile');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('DEV-LOBBY-01');
    expect(screen.getByLabelText(/assigned office location/i)).toHaveValue('1');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('ZKTeco ProCapture');
    expect(screen.getByLabelText(/device lifecycle status/i)).toHaveValue('ACTIVE');
    expect(screen.getByLabelText(/active terminal/i)).toBeChecked();

    // Switch to sampleDevice2 with a different key
    rerender(
      <DeviceModal
        key={`edit-device-${sampleDevice2.id}`}
        isOpen={true}
        mode="edit"
        offices={sampleOffices}
        initialData={sampleDevice2}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByLabelText(/device descriptive name/i)).toHaveValue('Warehouse Gate 2');
    expect(screen.getByLabelText(/device code/i)).toHaveValue('DEV-WH-02');
    expect(screen.getByLabelText(/assigned office location/i)).toHaveValue('2');
    expect(screen.getByLabelText(/hardware model/i)).toHaveValue('Suprema BioEntry');
    expect(screen.getByLabelText(/ip address/i)).toHaveValue('192.168.2.200');
    expect(screen.getByLabelText(/mac address/i)).toHaveValue('00:11:22:33:44:55');
    expect(screen.getByLabelText(/device lifecycle status/i)).toHaveValue('INACTIVE');
    expect(screen.getByLabelText(/active terminal/i)).not.toBeChecked();
  });
});
