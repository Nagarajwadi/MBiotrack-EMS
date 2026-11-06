import React, { useEffect, useState } from 'react';
import type { AssignmentCreatePayload } from '../types/assignment';
import type { Employee } from '../types/employee';
import type { Office } from '../types/office';
import './components.css';

export interface AssignmentModalProps {
  isOpen: boolean;
  employees: Employee[];
  offices: Office[];
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: AssignmentCreatePayload) => void;
}

interface FormState {
  employee_id: string;
  office_id: string;
  valid_from: string;
  valid_to: string;
  is_primary: boolean;
}

interface FormErrors {
  employee_id?: string;
  office_id?: string;
  valid_from?: string;
  valid_to?: string;
}

function getDefaultDateTime(offsetHours = 0): string {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours);
  d.setMinutes(0, 0, 0);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getInitialAssignmentFormState(employees: Employee[], offices: Office[]): FormState {
  const defaultEmp = employees.length > 0 ? String(employees[0].id) : '';
  const defaultOff = offices.length > 0 ? String(offices[0].id) : '';
  return {
    employee_id: defaultEmp,
    office_id: defaultOff,
    valid_from: getDefaultDateTime(0),
    valid_to: getDefaultDateTime(24 * 365), // 1 year default
    is_primary: true,
  };
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  isOpen,
  employees,
  offices,
  isSubmitting = false,
  serverError,
  onClose,
  onSubmit,
}) => {
  const [trackedTarget, setTrackedTarget] = useState({
    open: isOpen,
    empCount: employees.length,
    offCount: offices.length,
  });
  const [form, setForm] = useState<FormState>(getInitialAssignmentFormState(employees, offices));
  const [errors, setErrors] = useState<FormErrors>({});

  if (
    trackedTarget.open !== isOpen ||
    trackedTarget.empCount !== employees.length ||
    trackedTarget.offCount !== offices.length
  ) {
    setTrackedTarget({ open: isOpen, empCount: employees.length, offCount: offices.length });
    setForm(getInitialAssignmentFormState(employees, offices));
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
    if (!form.employee_id || parseInt(form.employee_id, 10) <= 0) {
      errs.employee_id = 'Please select an employee.';
    }
    if (!form.office_id || parseInt(form.office_id, 10) <= 0) {
      errs.office_id = 'Please select an office location.';
    }
    if (!form.valid_from) {
      errs.valid_from = 'Start date/time is required.';
    }
    if (!form.valid_to) {
      errs.valid_to = 'End date/time is required.';
    }
    if (form.valid_from && form.valid_to) {
      const fromTime = new Date(form.valid_from).getTime();
      const toTime = new Date(form.valid_to).getTime();
      if (toTime <= fromTime) {
        errs.valid_to = 'Effective end date must be strictly after the start date.';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const fromDate = new Date(form.valid_from);
    const toDate = new Date(form.valid_to);

    const payload: AssignmentCreatePayload = {
      employee_id: parseInt(form.employee_id, 10),
      office_id: parseInt(form.office_id, 10),
      valid_from: fromDate.toISOString(),
      valid_to: toDate.toISOString(),
      is_primary: form.is_primary,
    };

    onSubmit(payload);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-modal-title"
    >
      <div className="modal-container assignment-modal-container">
        <div className="modal-header">
          <h3 id="assignment-modal-title">Create Office Assignment</h3>
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
              <label htmlFor="assignment-employee-id" className="form-label">
                Target Employee <span className="text-danger">*</span>
              </label>
              <select
                id="assignment-employee-id"
                className={`form-select ${errors.employee_id ? 'input-error' : ''}`}
                value={form.employee_id}
                onChange={(e) => {
                  setForm({ ...form, employee_id: e.target.value });
                  if (errors.employee_id) setErrors({ ...errors, employee_id: undefined });
                }}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.employee_id)}
                aria-describedby={errors.employee_id ? 'assign-emp-error' : undefined}
                autoFocus
              >
                <option value="">Select an employee...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name} ({emp.employee_code}) - {emp.department}
                  </option>
                ))}
              </select>
              {errors.employee_id && (
                <span id="assign-emp-error" className="field-error">
                  {errors.employee_id}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="assignment-office-id" className="form-label">
                Assigned Office Location <span className="text-danger">*</span>
              </label>
              <select
                id="assignment-office-id"
                className={`form-select ${errors.office_id ? 'input-error' : ''}`}
                value={form.office_id}
                onChange={(e) => {
                  setForm({ ...form, office_id: e.target.value });
                  if (errors.office_id) setErrors({ ...errors, office_id: undefined });
                }}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.office_id)}
                aria-describedby={errors.office_id ? 'assign-off-error' : undefined}
              >
                <option value="">Select an office...</option>
                {offices.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.name} ({off.code}) {!off.is_active ? '[Inactive]' : ''}
                  </option>
                ))}
              </select>
              {errors.office_id && (
                <span id="assign-off-error" className="field-error">
                  {errors.office_id}
                </span>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="assignment-valid-from" className="form-label">
                  Effective Start (Valid From) <span className="text-danger">*</span>
                </label>
                <input
                  id="assignment-valid-from"
                  type="datetime-local"
                  className={`form-input ${errors.valid_from ? 'input-error' : ''}`}
                  value={form.valid_from}
                  onChange={(e) => {
                    setForm({ ...form, valid_from: e.target.value });
                    if (errors.valid_from) setErrors({ ...errors, valid_from: undefined });
                  }}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.valid_from)}
                  aria-describedby={errors.valid_from ? 'assign-from-error' : undefined}
                />
                {errors.valid_from && (
                  <span id="assign-from-error" className="field-error">
                    {errors.valid_from}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="assignment-valid-to" className="form-label">
                  Effective End (Valid To) <span className="text-danger">*</span>
                </label>
                <input
                  id="assignment-valid-to"
                  type="datetime-local"
                  className={`form-input ${errors.valid_to ? 'input-error' : ''}`}
                  value={form.valid_to}
                  onChange={(e) => {
                    setForm({ ...form, valid_to: e.target.value });
                    if (errors.valid_to) setErrors({ ...errors, valid_to: undefined });
                  }}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors.valid_to)}
                  aria-describedby={errors.valid_to ? 'assign-to-error' : undefined}
                />
                {errors.valid_to && (
                  <span id="assign-to-error" className="field-error">
                    {errors.valid_to}
                  </span>
                )}
              </div>
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
                  disabled={isSubmitting}
                />
                <span>Primary Office Assignment</span>
              </label>
              <small className="form-help-text" style={{ display: 'block', marginTop: '0.25rem', color: '#64748b' }}>
                PostgreSQL GiST constraint protects against overlapping date intervals for the same employee.
              </small>
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
              {isSubmitting ? 'Creating Assignment...' : 'Assign Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
