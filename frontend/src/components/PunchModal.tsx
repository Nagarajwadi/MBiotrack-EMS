import React, { useEffect, useState } from 'react';
import { getDevices } from '../api/deviceApi';
import { getEmployees } from '../api/employeeApi';
import type { User } from '../types/auth';
import type { AttendancePunchCreatePayload } from '../types/attendance';
import type { Device } from '../types/device';
import type { Employee } from '../types/employee';
import './components.css';

export interface PunchModalProps {
  isOpen: boolean;
  currentUser: User;
  defaultPunchType?: 'CHECK_IN' | 'CHECK_OUT';
  targetEmployeeId?: number | null;
  targetEmployeeName?: string | null;
  employees?: Employee[];
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: AttendancePunchCreatePayload) => void;
}

export const PunchModal: React.FC<PunchModalProps> = ({
  isOpen,
  currentUser,
  defaultPunchType = 'CHECK_IN',
  targetEmployeeId,
  targetEmployeeName,
  employees: propEmployees,
  isSubmitting = false,
  serverError = null,
  onClose,
  onSubmit,
}) => {
  const isEmployee = currentUser.role === 'EMPLOYEE';

  const [trackedOpen, setTrackedOpen] = useState(isOpen);
  const [punchType, setPunchType] = useState<'CHECK_IN' | 'CHECK_OUT'>(defaultPunchType);
  const [deviceId, setDeviceId] = useState<string>('');
  const [employeeIdInput, setEmployeeIdInput] = useState<string>(
    targetEmployeeId ? String(targetEmployeeId) : ''
  );

  const [devices, setDevices] = useState<Device[]>([]);
  const [isDevicesLoading, setIsDevicesLoading] = useState<boolean>(true);
  const [deviceLoadError, setDeviceLoadError] = useState<string | null>(null);

  const [fetchedEmployees, setFetchedEmployees] = useState<Employee[]>([]);
  const [isEmployeesLoading, setIsEmployeesLoading] = useState<boolean>(
    Boolean(!propEmployees && !isEmployee && !targetEmployeeId)
  );
  const [employeeLoadError, setEmployeeLoadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const employees = propEmployees ?? fetchedEmployees;

  // Sync state when modal opens
  if (trackedOpen !== isOpen) {
    setTrackedOpen(isOpen);
    if (isOpen) {
      setPunchType(defaultPunchType);
      setEmployeeIdInput(targetEmployeeId ? String(targetEmployeeId) : '');
      setValidationError(null);
      setIsDevicesLoading(true);
      setDeviceLoadError(null);
      if (!propEmployees && !isEmployee && !targetEmployeeId) {
        setIsEmployeesLoading(true);
        setEmployeeLoadError(null);
      }
    }
  }

  // Fetch active devices when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    getDevices({ active_only: true })
      .then((data) => {
        if (!isMounted) return;
        setDevices(data);
        if (data.length > 0) {
          setDeviceId(String(data[0].id));
        } else {
          setDeviceId('');
        }
        setIsDevicesLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setDeviceLoadError('Unable to load active terminal devices.');
        setIsDevicesLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Fetch active employees when modal opens in manual punch mode (non-employee without pre-selected target)
  useEffect(() => {
    if (!isOpen || propEmployees || isEmployee || targetEmployeeId) return;

    let isMounted = true;

    getEmployees('ACTIVE')
      .then((data) => {
        if (!isMounted) return;
        setFetchedEmployees(data);
        setIsEmployeesLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setEmployeeLoadError('Unable to load active employees.');
        setIsEmployeesLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, propEmployees, isEmployee, targetEmployeeId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const parsedDeviceId = parseInt(deviceId, 10);
    if (!deviceId || isNaN(parsedDeviceId) || parsedDeviceId <= 0) {
      setValidationError('Please select an active biometric terminal device.');
      return;
    }

    let finalEmployeeId: number | undefined = undefined;
    if (targetEmployeeId) {
      finalEmployeeId = targetEmployeeId;
    } else if (isEmployee) {
      if (currentUser.employee_id) {
        finalEmployeeId = currentUser.employee_id;
      }
    } else {
      const parsedEmpId = parseInt(employeeIdInput.trim(), 10);
      if (employeeIdInput.trim() && !isNaN(parsedEmpId) && parsedEmpId > 0) {
        finalEmployeeId = parsedEmpId;
      } else {
        setValidationError('Please select an active employee.');
        return;
      }
    }

    setValidationError(null);

    const payload: AttendancePunchCreatePayload = {
      device_id: parsedDeviceId,
      punch_type: punchType,
      idempotency_key:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `punch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    if (finalEmployeeId) {
      payload.employee_id = finalEmployeeId;
    }

    onSubmit(payload);
  };

  const displayName = targetEmployeeName || (isEmployee ? currentUser.full_name : null);

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="punch-modal-title"
      >
        <div className="modal-header">
          <h2 id="punch-modal-title">
            {punchType === 'CHECK_IN' ? 'Check In Confirmation' : 'Check Out Confirmation'}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {serverError && (
              <div className="alert-banner error" role="alert">
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{serverError}</span>
                </div>
              </div>
            )}

            {validationError && (
              <div className="alert-banner error" role="alert">
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{validationError}</span>
                </div>
              </div>
            )}

            {deviceLoadError && (
              <div className="alert-banner error" role="alert">
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{deviceLoadError}</span>
                </div>
              </div>
            )}

            {/* Target Employee Info */}
            {displayName && (
              <div className="form-group">
                <span className="field-label">Target Employee</span>
                <div className="readonly-field-box">
                  <strong>{displayName}</strong>
                  {targetEmployeeId && (
                    <span className="text-muted"> (ID: #{targetEmployeeId})</span>
                  )}
                </div>
              </div>
            )}

            {/* Non-employee target selection dropdown */}
            {!isEmployee && !targetEmployeeId && (
              <div className="form-group">
                <label htmlFor="punch-employee-id" className="field-label">
                  Target Employee <span className="required-star">*</span>
                </label>
                {isEmployeesLoading ? (
                  <div
                    className="table-state-description"
                    role="status"
                    aria-label="Loading active employees"
                  >
                    Loading active employees...
                  </div>
                ) : employeeLoadError ? (
                  <div className="alert-banner error" role="alert">
                    <div className="alert-content">
                      <span aria-hidden="true">⚠️</span>
                      <span>{employeeLoadError}</span>
                    </div>
                  </div>
                ) : employees.length === 0 ? (
                  <div className="alert-banner error" role="alert">
                    <div className="alert-content">
                      <span aria-hidden="true">⚠️</span>
                      <span>No active employees are available. Please add an employee first.</span>
                    </div>
                  </div>
                ) : (
                  <select
                    id="punch-employee-id"
                    className="form-control"
                    value={employeeIdInput}
                    onChange={(e) => {
                      setEmployeeIdInput(e.target.value);
                      if (validationError) setValidationError(null);
                    }}
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">Select an employee...</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={String(emp.id)}>
                        {emp.first_name} {emp.last_name} ({emp.employee_code})
                        {emp.department ? ` — ${emp.department}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Punch Type Selection */}
            <div className="form-group">
              <span className="field-label" id="punch-type-label">
                Punch Type <span className="required-star">*</span>
              </span>
              <div
                className="punch-type-radio-group"
                role="radiogroup"
                aria-labelledby="punch-type-label"
              >
                <label className={`punch-type-option ${punchType === 'CHECK_IN' ? 'selected-in' : ''}`}>
                  <input
                    type="radio"
                    name="punchType"
                    value="CHECK_IN"
                    checked={punchType === 'CHECK_IN'}
                    onChange={() => setPunchType('CHECK_IN')}
                    disabled={isSubmitting}
                  />
                  <span className="punch-option-text">
                    <span className="punch-option-title">🟢 Check In</span>
                    <span className="punch-option-desc">Start your work session or return from break</span>
                  </span>
                </label>

                <label className={`punch-type-option ${punchType === 'CHECK_OUT' ? 'selected-out' : ''}`}>
                  <input
                    type="radio"
                    name="punchType"
                    value="CHECK_OUT"
                    checked={punchType === 'CHECK_OUT'}
                    onChange={() => setPunchType('CHECK_OUT')}
                    disabled={isSubmitting}
                  />
                  <span className="punch-option-text">
                    <span className="punch-option-title">🔴 Check Out</span>
                    <span className="punch-option-desc">End your work session or departure for break</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Terminal Device Selection */}
            <div className="form-group">
              <label htmlFor="punch-device-select" className="field-label">
                Biometric Terminal Device <span className="required-star">*</span>
              </label>
              {isDevicesLoading ? (
                <div className="table-state-description">Loading available terminal devices...</div>
              ) : devices.length === 0 ? (
                <div className="alert-banner error" role="alert">
                  <div className="alert-content">
                    <span>No active biometric terminal devices are available. Please contact an administrator.</span>
                  </div>
                </div>
              ) : (
                <select
                  id="punch-device-select"
                  className="form-control"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  disabled={isSubmitting}
                  required
                >
                  {devices.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.name} ({dev.device_code}) — Office #{dev.office_id}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Audit / Policy Notice */}
            <div className="audit-notice-box">
              <p className="notice-text">
                ℹ️ <strong>System Attribution:</strong> Punches are attributed to the active terminal device with server-validated timestamps. Roaming detection evaluates office assignments under policy GOV-08.
              </p>
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
              className={`btn ${punchType === 'CHECK_IN' ? 'btn-primary' : 'btn-danger'}`}
              disabled={
                isSubmitting ||
                isDevicesLoading ||
                devices.length === 0 ||
                (!isEmployee &&
                  !targetEmployeeId &&
                  (isEmployeesLoading || employees.length === 0 || !employeeIdInput))
              }
            >
              {isSubmitting
                ? 'Recording Punch...'
                : punchType === 'CHECK_IN'
                ? 'Confirm Check In'
                : 'Confirm Check Out'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
