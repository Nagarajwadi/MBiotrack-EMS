import React, { useState } from 'react';
import type { UserAccount, UserRoleUpdatePayload } from '../types/userManagement';
import './components.css';

export interface UserRoleModalProps {
  isOpen: boolean;
  user: UserAccount | null;
  onClose: () => void;
  onSubmit: (userId: number, payload: UserRoleUpdatePayload) => Promise<void>;
}

export const UserRoleModal: React.FC<UserRoleModalProps> = ({
  isOpen,
  user,
  onClose,
  onSubmit,
}) => {
  const [selectedRole, setSelectedRole] = useState<'EMPLOYEE' | 'MANAGER' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !user) return null;

  // Default to opposite role for quick promotion/demotion if not explicitly chosen yet
  const targetRole = selectedRole ?? (user.role === 'MANAGER' ? 'EMPLOYEE' : 'MANAGER');

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    setSelectedRole(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (targetRole === user.role) {
      setError(`User is already assigned the ${targetRole} role.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(user.id, { role: targetRole });
      setSelectedRole(null);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update user role.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-role-modal-title"
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="user-role-modal-title">Change User Role</h2>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close dialog"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="alert-banner error mb-4" role="alert" data-testid="role-modal-error">
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{error}</span>
                </div>
              </div>
            )}

            <div className="reset-user-summary mb-3 p-3 bg-light rounded">
              <p className="mb-1">
                <strong>Target User:</strong> {user.full_name}
              </p>
              <p className="mb-1">
                <strong>Email:</strong> {user.email}
              </p>
              <p className="mb-0">
                <strong>Current Role:</strong>{' '}
                <span className={`user-role-badge role-${user.role.toLowerCase()}`}>
                  {user.role}
                </span>
              </p>
            </div>

            <div className="form-group mb-3">
              <label htmlFor="user-new-role-select">
                New Role <span className="required">*</span>
              </label>
              <select
                id="user-new-role-select"
                className="form-control"
                value={targetRole}
                onChange={(e) => {
                  setSelectedRole(e.target.value as 'EMPLOYEE' | 'MANAGER');
                  setError(null);
                }}
                disabled={isSubmitting}
                required
              >
                <option value="EMPLOYEE">EMPLOYEE</option>
                <option value="MANAGER">MANAGER</option>
              </select>
              <small className="form-text text-muted" style={{ display: 'block', marginTop: '0.5rem' }}>
                {targetRole === 'MANAGER'
                  ? 'Manager access: Can access company directory, view team attendance, and review/approve/reject leave requests.'
                  : 'Employee access: Standard staff access to personal dashboard, personal leaves, and attendance.'}
              </small>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Updating...' : 'Change Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
