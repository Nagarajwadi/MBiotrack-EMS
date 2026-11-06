import React, { useEffect, useState } from 'react';
import type {
  Device,
  DeviceCreatePayload,
  DeviceStatus,
  DeviceUpdatePayload,
} from '../types/device';
import type { Office } from '../types/office';
import './components.css';

export interface DeviceModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  offices: Office[];
  initialData?: Device | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: DeviceCreatePayload | DeviceUpdatePayload) => void;
}

interface FormState {
  office_id: string;
  name: string;
  device_code: string;
  serial_number: string;
  model_name: string;
  ip_address: string;
  mac_address: string;
  status: DeviceStatus;
  is_active: boolean;
}

interface FormErrors {
  office_id?: string;
  name?: string;
  device_code?: string;
  serial_number?: string;
  mac_address?: string;
}

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

function getInitialDeviceFormState(
  mode: 'create' | 'edit',
  offices: Office[],
  initialData?: Device | null
): FormState {
  if (mode === 'edit' && initialData) {
    return {
      office_id: String(initialData.office_id),
      name: initialData.name,
      device_code: initialData.device_code,
      serial_number: initialData.serial_number,
      model_name: initialData.model_name || '',
      ip_address: initialData.ip_address || '',
      mac_address: initialData.mac_address || '',
      status: (initialData.status as DeviceStatus) || 'ACTIVE',
      is_active: initialData.is_active,
    };
  }
  const defaultOfficeId = offices.length > 0 ? String(offices[0].id) : '';
  return {
    office_id: defaultOfficeId,
    name: '',
    device_code: '',
    serial_number: '',
    model_name: '',
    ip_address: '',
    mac_address: '',
    status: 'ACTIVE',
    is_active: true,
  };
}

export const DeviceModal: React.FC<DeviceModalProps> = ({
  isOpen,
  mode,
  offices,
  initialData,
  isSubmitting = false,
  serverError,
  onClose,
  onSubmit,
}) => {
  const [trackedTarget, setTrackedTarget] = useState({
    open: isOpen,
    mode,
    id: initialData?.id,
  });
  const [form, setForm] = useState<FormState>(getInitialDeviceFormState(mode, offices, initialData));
  const [errors, setErrors] = useState<FormErrors>({});

  if (
    trackedTarget.open !== isOpen ||
    trackedTarget.mode !== mode ||
    trackedTarget.id !== initialData?.id
  ) {
    setTrackedTarget({ open: isOpen, mode, id: initialData?.id });
    setForm(getInitialDeviceFormState(mode, offices, initialData));
    setErrors({});
  }

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!form.office_id || parseInt(form.office_id, 10) <= 0) {
      errs.office_id = 'Please select an office location.';
    }
    if (!form.name.trim()) {
      errs.name = 'Device name is required.';
    }
    if (!form.device_code.trim()) {
      errs.device_code = 'Device code is required.';
    }
    if (!form.serial_number.trim()) {
      errs.serial_number = 'Serial number is required.';
    }
    if (form.mac_address.trim() && !MAC_REGEX.test(form.mac_address.trim())) {
      errs.mac_address = 'Invalid MAC address format (expected XX:XX:XX:XX:XX:XX).';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const officeId = parseInt(form.office_id, 10);
    const mac = form.mac_address.trim() ? form.mac_address.trim().toUpperCase() : null;

    if (mode === 'create') {
      const payload: DeviceCreatePayload = {
        office_id: officeId,
        name: form.name.trim(),
        device_code: form.device_code.trim().toUpperCase(),
        serial_number: form.serial_number.trim().toUpperCase(),
        model_name: form.model_name.trim() || null,
        ip_address: form.ip_address.trim() || null,
        mac_address: mac,
        status: form.status,
        is_active: form.is_active,
      };
      onSubmit(payload);
    } else {
      const payload: DeviceUpdatePayload = {
        office_id: officeId,
        name: form.name.trim(),
        device_code: form.device_code.trim().toUpperCase(),
        serial_number: form.serial_number.trim().toUpperCase(),
        model_name: form.model_name.trim() || null,
        ip_address: form.ip_address.trim() || null,
        mac_address: mac,
        status: form.status,
        is_active: form.is_active,
      };
      onSubmit(payload);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-modal-title"
    >
      <div className="modal-container device-modal-container">
        <div className="modal-header">
          <h3 id="device-modal-title">
            {mode === 'create' ? 'Register New Device' : 'Edit Device'}
          </h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {serverError && (
              <div className="alert-banner error" role="alert" style={{ marginBottom: '1rem' }}>
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{serverError}</span>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="device-office-id" className="form-label">
                Assigned Office Location <span className="text-danger">*</span>
              </label>
              <select
                id="device-office-id"
                className={`form-select ${errors.office_id ? 'input-error' : ''}`}
                value={form.office_id}
                onChange={(e) => {
                  setForm({ ...form, office_id: e.target.value });
                  if (errors.office_id) setErrors({ ...errors, office_id: undefined });
                }}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.office_id)}
                aria-describedby={errors.office_id ? 'device-office-error' : undefined}
              >
                <option value="">Select an office...</option>
                {offices.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.name} ({off.code}) {!off.is_active ? '[Inactive]' : ''}
                  </option>
                ))}
              </select>
              {errors.office_id && (
                <span id="device-office-error" className="field-error">
                  {errors.office_id}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="device-name" className="form-label">
                Device Descriptive Name <span className="text-danger">*</span>
              </label>
              <input
                id="device-name"
                type="text"
                className={`form-input ${errors.name ? 'input-error' : ''}`}
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
                placeholder="e.g. Main Lobby Turnstile East"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'device-name-error' : undefined}
                autoFocus
              />
              {errors.name && (
                <span id="device-name-error" className="field-error">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="device-code" className="form-label">
                  Device Code <span className="text-danger">*</span>
                </label>
                <input
                  id="device-code"
                  type="text"
                  className={`form-input ${errors.device_code ? 'input-error' : ''}`}
                  value={form.device_code}
                  onChange={(e) => {
                    setForm({ ...form, device_code: e.target.value });
                    if (errors.device_code) setErrors({ ...errors, device_code: undefined });
                  }}
                  placeholder="e.g. DEV-HQ-01"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.device_code)}
                  aria-describedby={errors.device_code ? 'device-code-error' : undefined}
                />
                {errors.device_code && (
                  <span id="device-code-error" className="field-error">
                    {errors.device_code}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="device-serial" className="form-label">
                  Serial Number <span className="text-danger">*</span>
                </label>
                <input
                  id="device-serial"
                  type="text"
                  className={`form-input ${errors.serial_number ? 'input-error' : ''}`}
                  value={form.serial_number}
                  onChange={(e) => {
                    setForm({ ...form, serial_number: e.target.value });
                    if (errors.serial_number) setErrors({ ...errors, serial_number: undefined });
                  }}
                  placeholder="e.g. SN-883921-A"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.serial_number)}
                  aria-describedby={errors.serial_number ? 'device-serial-error' : undefined}
                />
                {errors.serial_number && (
                  <span id="device-serial-error" className="field-error">
                    {errors.serial_number}
                  </span>
                )}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="device-model" className="form-label">
                  Hardware Model
                </label>
                <input
                  id="device-model"
                  type="text"
                  className="form-input"
                  value={form.model_name}
                  onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                  placeholder="e.g. ProCapture-T"
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="device-ip" className="form-label">
                  IP Address
                </label>
                <input
                  id="device-ip"
                  type="text"
                  className="form-input"
                  value={form.ip_address}
                  onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
                  placeholder="e.g. 192.168.1.50"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="device-mac" className="form-label">
                  MAC Address
                </label>
                <input
                  id="device-mac"
                  type="text"
                  className={`form-input ${errors.mac_address ? 'input-error' : ''}`}
                  value={form.mac_address}
                  onChange={(e) => {
                    setForm({ ...form, mac_address: e.target.value });
                    if (errors.mac_address) setErrors({ ...errors, mac_address: undefined });
                  }}
                  placeholder="e.g. 00:1A:2B:3C:4D:5E"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.mac_address)}
                  aria-describedby={errors.mac_address ? 'device-mac-error' : undefined}
                />
                {errors.mac_address && (
                  <span id="device-mac-error" className="field-error">
                    {errors.mac_address}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="device-status" className="form-label">
                  Device Lifecycle Status
                </label>
                <select
                  id="device-status"
                  className="form-select"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as DeviceStatus,
                      is_active: e.target.value === 'ACTIVE',
                    })
                  }
                  disabled={isSubmitting}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="DECOMMISSIONED">DECOMMISSIONED</option>
                </select>
              </div>
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      is_active: e.target.checked,
                      status: e.target.checked ? 'ACTIVE' : form.status === 'DECOMMISSIONED' ? 'DECOMMISSIONED' : 'INACTIVE',
                    })
                  }
                  disabled={isSubmitting || form.status === 'DECOMMISSIONED'}
                />
                <span>Active Terminal (Receiving Punches)</span>
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Saving...'
                : mode === 'create'
                  ? 'Register Device'
                  : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
