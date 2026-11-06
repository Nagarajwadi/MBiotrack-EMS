import React, { useEffect, useState } from 'react';
import type { User } from '../types/auth';
import type { LeaveRequestCreatePayload, LeaveType } from '../types/leave';
import './components.css';

export interface LeaveModalProps {
  isOpen: boolean;
  currentUser: User;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: LeaveRequestCreatePayload) => void;
}

interface FormState {
  start_date: string;
  end_date: string;
  leave_type: LeaveType;
  reason: string;
  employee_id: string;
}

interface FormErrors {
  start_date?: string;
  end_date?: string;
  employee_id?: string;
}

const getTodayUtc = () => new Date().toISOString().split('T')[0];

export const LeaveModal: React.FC<LeaveModalProps> = ({
  isOpen,
  currentUser,
  isSubmitting = false,
  serverError = null,
  onClose,
  onSubmit,
}) => {
  const isEmployee = currentUser.role === 'EMPLOYEE';

  const [trackedOpen, setTrackedOpen] = useState(isOpen);
  const [formState, setFormState] = useState<FormState>(() => ({
    start_date: getTodayUtc(),
    end_date: getTodayUtc(),
    leave_type: 'ANNUAL',
    reason: '',
    employee_id: '',
  }));

  const [errors, setErrors] = useState<FormErrors>({});

  if (trackedOpen !== isOpen) {
    setTrackedOpen(isOpen);
    if (isOpen) {
      setFormState({
        start_date: getTodayUtc(),
        end_date: getTodayUtc(),
        leave_type: 'ANNUAL',
        reason: '',
        employee_id: '',
      });
      setErrors({});
    }
  }

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

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.start_date.trim()) {
      newErrors.start_date = 'Start date is required.';
    }
    if (!formState.end_date.trim()) {
      newErrors.end_date = 'End date is required.';
    } else if (formState.start_date && formState.end_date < formState.start_date) {
      newErrors.end_date = 'End date cannot be earlier than start date.';
    }

    if (!isEmployee && formState.employee_id.trim()) {
      const parsed = parseInt(formState.employee_id.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        newErrors.employee_id = 'Please enter a valid positive Employee ID.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    const payload: LeaveRequestCreatePayload = {
      start_date: formState.start_date.trim(),
      end_date: formState.end_date.trim(),
      leave_type: formState.leave_type,
      reason: formState.reason.trim() || undefined,
    };

    if (!isEmployee && formState.employee_id.trim()) {
      payload.employee_id = parseInt(formState.employee_id.trim(), 10);
    }

    onSubmit(payload);
  };

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
        aria-labelledby="leave-modal-title"
      >
        <div className="modal-header">
          <h2 id="leave-modal-title">Request Leave</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close leave request modal"
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

            {/* Employee ID (Admin/Manager only) */}
            {!isEmployee && (
              <div className="form-group">
                <label htmlFor="leave-emp-id">
                  Target Employee ID <span className="text-muted">(Optional, defaults to self)</span>
                </label>
                <input
                  id="leave-emp-id"
                  type="number"
                  min="1"
                  className={`form-input ${errors.employee_id ? 'input-error' : ''}`}
                  placeholder="e.g. 101"
                  value={formState.employee_id}
                  onChange={(e) => setFormState({ ...formState, employee_id: e.target.value })}
                  disabled={isSubmitting}
                />
                {errors.employee_id && (
                  <span className="field-error" role="alert">
                    {errors.employee_id}
                  </span>
                )}
              </div>
            )}

            {/* Leave Type */}
            <div className="form-group">
              <label htmlFor="leave-type">Leave Category *</label>
              <select
                id="leave-type"
                className="form-select"
                value={formState.leave_type}
                onChange={(e) =>
                  setFormState({ ...formState, leave_type: e.target.value as LeaveType })
                }
                disabled={isSubmitting}
              >
                <option value="ANNUAL">Annual Leave (Planned / Vacation)</option>
                <option value="SICK">Sick Leave (Medical / Health)</option>
                <option value="CASUAL">Casual Leave (Urgent / Personal)</option>
                <option value="UNPAID">Unpaid Leave</option>
              </select>
            </div>

            {/* Date Range */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="leave-start-date">Start Date *</label>
                <input
                  id="leave-start-date"
                  type="date"
                  className={`form-input ${errors.start_date ? 'input-error' : ''}`}
                  value={formState.start_date}
                  onChange={(e) => setFormState({ ...formState, start_date: e.target.value })}
                  disabled={isSubmitting}
                  required
                />
                {errors.start_date && (
                  <span className="field-error" role="alert">
                    {errors.start_date}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="leave-end-date">End Date *</label>
                <input
                  id="leave-end-date"
                  type="date"
                  className={`form-input ${errors.end_date ? 'input-error' : ''}`}
                  value={formState.end_date}
                  onChange={(e) => setFormState({ ...formState, end_date: e.target.value })}
                  disabled={isSubmitting}
                  required
                />
                {errors.end_date && (
                  <span className="field-error" role="alert">
                    {errors.end_date}
                  </span>
                )}
              </div>
            </div>

            {/* Reason */}
            <div className="form-group">
              <label htmlFor="leave-reason">
                Reason / Notes <span className="text-muted">(Optional)</span>
              </label>
              <textarea
                id="leave-reason"
                className="form-textarea"
                rows={3}
                placeholder="Provide details or justification for your leave request..."
                value={formState.reason}
                onChange={(e) => setFormState({ ...formState, reason: e.target.value })}
                disabled={isSubmitting}
                maxLength={1000}
                data-testid="leave-reason-input"
              />
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
              data-testid="submit-leave-btn"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
