import React, { useState } from 'react';
import type { Employee } from '../types/employee';
import type {
  EmployeeLeaveEntitlement,
  LeaveEntitlementDefault,
} from '../types/leave';
import './components.css';

export interface LeaveEntitlementModalProps {
  isOpen: boolean;
  mode: 'default' | 'override';
  year: number;
  initialDefault?: LeaveEntitlementDefault | null;
  initialOverride?: EmployeeLeaveEntitlement | null;
  employees?: Employee[];
  onClose: () => void;
  onSaveDefault: (payload: {
    year: number;
    leave_type: string;
    allocated_days: number;
  }) => Promise<void>;
  onSaveOverride: (payload: {
    employee_id: number;
    year: number;
    leave_type: string;
    allocated_days: number;
  }) => Promise<void>;
}

export const LeaveEntitlementModal: React.FC<LeaveEntitlementModalProps> = ({
  isOpen,
  mode,
  year,
  initialDefault,
  initialOverride,
  employees = [],
  onClose,
  onSaveDefault,
  onSaveOverride,
}) => {
  const [trackedOpen, setTrackedOpen] = useState({
    open: isOpen,
    mode,
    defaultType: initialDefault?.leave_type,
    defaultDays: initialDefault?.allocated_days,
    overrideId: initialOverride?.id,
  });

  const [leaveType, setLeaveType] = useState<string>(
    initialDefault?.leave_type || initialOverride?.leave_type || 'ANNUAL'
  );
  const [allocatedDays, setAllocatedDays] = useState<number>(
    initialDefault?.allocated_days ?? initialOverride?.allocated_days ?? 15
  );
  const [employeeId, setEmployeeId] = useState<string>(
    initialOverride?.employee_id ? String(initialOverride.employee_id) : employees[0]?.id ? String(employees[0].id) : ''
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (
    trackedOpen.open !== isOpen ||
    trackedOpen.mode !== mode ||
    trackedOpen.defaultType !== initialDefault?.leave_type ||
    trackedOpen.defaultDays !== initialDefault?.allocated_days ||
    trackedOpen.overrideId !== initialOverride?.id
  ) {
    setTrackedOpen({
      open: isOpen,
      mode,
      defaultType: initialDefault?.leave_type,
      defaultDays: initialDefault?.allocated_days,
      overrideId: initialOverride?.id,
    });
    setLeaveType(initialDefault?.leave_type || initialOverride?.leave_type || 'ANNUAL');
    setAllocatedDays(initialDefault?.allocated_days ?? initialOverride?.allocated_days ?? 15);
    setEmployeeId(initialOverride?.employee_id ? String(initialOverride.employee_id) : employees[0]?.id ? String(employees[0].id) : '');
    setError(null);
  }

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (allocatedDays < 0) {
      setError('Allocated days cannot be negative.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'default') {
        await onSaveDefault({
          year,
          leave_type: leaveType,
          allocated_days: Number(allocatedDays),
        });
      } else {
        const empIdNum = parseInt(employeeId, 10);
        if (isNaN(empIdNum) || empIdNum <= 0) {
          setError('Please select a valid employee.');
          setIsSubmitting(false);
          return;
        }
        await onSaveOverride({
          employee_id: empIdNum,
          year,
          leave_type: leaveType,
          allocated_days: Number(allocatedDays),
        });
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save entitlement.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title =
    mode === 'default'
      ? `Configure Org Default Entitlement (${year})`
      : `Configure Employee Override (${year})`;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entitlement-modal-title"
      >
        <div className="modal-header">
          <h2 id="entitlement-modal-title">{title}</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close entitlement modal"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {mode === 'override' && (
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label htmlFor="override-employee-select" className="form-label">
                  Employee *
                </label>
                <select
                  id="override-employee-select"
                  className="filter-select"
                  style={{ width: '100%' }}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  disabled={isSubmitting || Boolean(initialOverride)}
                  required
                  data-testid="override-employee-select"
                >
                  <option value="">Select Employee...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_code}) - {emp.department || 'No Dept'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="entitlement-leave-type-select" className="form-label">
                Leave Category *
              </label>
              <select
                id="entitlement-leave-type-select"
                className="filter-select"
                style={{ width: '100%' }}
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                disabled={isSubmitting || Boolean(initialDefault) || Boolean(initialOverride)}
                data-testid="entitlement-leave-type-select"
              >
                <option value="ANNUAL">Annual Leave (ANNUAL)</option>
                <option value="SICK">Sick Leave (SICK)</option>
                <option value="CASUAL">Casual Leave (CASUAL)</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="entitlement-days-input" className="form-label">
                Annual Allocated Working Days *
              </label>
              <input
                id="entitlement-days-input"
                type="number"
                min="0"
                max="365"
                className="form-input"
                style={{ width: '100%' }}
                value={allocatedDays}
                onChange={(e) => setAllocatedDays(parseInt(e.target.value, 10) || 0)}
                disabled={isSubmitting}
                required
                data-testid="entitlement-days-input"
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                Fixed annual working days for calendar year {year}.
              </span>
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
              data-testid="save-entitlement-btn"
            >
              {isSubmitting ? 'Saving...' : 'Save Entitlement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
