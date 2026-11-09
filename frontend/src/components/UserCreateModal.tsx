import React, { useState } from 'react';
import type { Employee } from '../types/employee';
import type { UserCreatePayload } from '../types/userManagement';
import './components.css';

export interface UserCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: UserCreatePayload) => Promise<void>;
  employees: Employee[];
  existingUserEmployeeIds: Set<number>;
}

export const UserCreateModal: React.FC<UserCreateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  employees,
  existingUserEmployeeIds,
}) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [role, setRole] = useState<'EMPLOYEE' | 'MANAGER'>('EMPLOYEE');
  const [initialPassword, setInitialPassword] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  // Filter only active, non-deleted employees who do not yet have an account
  const eligibleEmployees = employees.filter(
    (e) => e.is_active && !e.deleted_at && !existingUserEmployeeIds.has(e.id)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedEmpId = parseInt(employeeId, 10);
    if (isNaN(parsedEmpId) || parsedEmpId <= 0) {
      setError('Please select an employee.');
      return;
    }

    if (initialPassword.length < 8) {
      setError('Initial password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        employee_id: parsedEmpId,
        role,
        initial_password: initialPassword,
        email: email.trim() ? email.trim() : undefined,
      });
      // Reset form on success
      setEmployeeId('');
      setInitialPassword('');
      setEmail('');
      setRole('EMPLOYEE');
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create user account.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="user-modal-title">Provision User Login Account</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="alert-banner alert-banner-error" role="alert">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="user-employee-select">
                Select Employee <span className="required">*</span>
              </label>
              {eligibleEmployees.length === 0 ? (
                <p className="field-hint text-warning">
                  All active employees currently have linked login accounts.
                </p>
              ) : (
                <select
                  id="user-employee-select"
                  className="form-control"
                  value={employeeId}
                  onChange={(e) => {
                    setEmployeeId(e.target.value);
                    const selected = eligibleEmployees.find(
                      (emp) => emp.id === parseInt(e.target.value, 10)
                    );
                    if (selected && !email) {
                      setEmail(selected.email);
                    }
                  }}
                  required
                  disabled={isSubmitting}
                >
                  <option value="">-- Choose an active employee --</option>
                  {eligibleEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_code}) - {emp.department}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="user-role-select">
                Assign Role <span className="required">*</span>
              </label>
              <select
                id="user-role-select"
                className="form-control"
                value={role}
                onChange={(e) => setRole(e.target.value as 'EMPLOYEE' | 'MANAGER')}
                required
                disabled={isSubmitting}
              >
                <option value="EMPLOYEE">EMPLOYEE</option>
                <option value="MANAGER">MANAGER</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="user-initial-password">
                Initial Password <span className="required">*</span>
              </label>
              <input
                id="user-initial-password"
                type="password"
                className="form-control"
                placeholder="At least 8 characters"
                value={initialPassword}
                onChange={(e) => setInitialPassword(e.target.value)}
                required
                minLength={8}
                disabled={isSubmitting}
              />
              <span className="field-hint">Securely hashed using Argon2id.</span>
            </div>

            <div className="form-group">
              <label htmlFor="user-email-override">
                Login Email (Optional override)
              </label>
              <input
                id="user-email-override"
                type="email"
                className="form-control"
                placeholder="Defaults to employee email if empty"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
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
              disabled={isSubmitting || eligibleEmployees.length === 0}
            >
              {isSubmitting ? 'Provisioning...' : 'Provision Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
