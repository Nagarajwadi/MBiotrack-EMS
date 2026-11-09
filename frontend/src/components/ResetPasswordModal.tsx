import React, { useState } from 'react';
import type { PasswordResetPayload, UserAccount } from '../types/userManagement';
import './components.css';

export interface ResetPasswordModalProps {
  isOpen: boolean;
  user: UserAccount | null;
  onClose: () => void;
  onSubmit: (userId: number, payload: PasswordResetPayload) => Promise<void>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  user,
  onClose,
  onSubmit,
}) => {
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen || !user) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError('Temporary password must be at least 12 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(user.id, { new_password: newPassword });
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to reset user password.');
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
      aria-labelledby="reset-password-modal-title"
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="reset-password-modal-title">Reset User Password</h2>
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

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {error && (
              <div className="alert-banner error mb-4" role="alert">
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
                <strong>Role:</strong> {user.role}
              </p>
            </div>

            <div className="form-group mb-3">
              <label htmlFor="reset-new-password-input">New Temporary Password *</label>
              <input
                id="reset-new-password-input"
                type="password"
                className="form-control"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 12 characters"
                required
                autoComplete="new-password"
                disabled={isSubmitting}
              />
              <small className="form-text text-muted">
                Must be at least 12 characters long.
              </small>
            </div>

            <div className="form-group mb-3">
              <label htmlFor="reset-confirm-password-input">Confirm Temporary Password *</label>
              <input
                id="reset-confirm-password-input"
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter temporary password"
                required
                autoComplete="new-password"
                disabled={isSubmitting}
              />
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
              {isSubmitting ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
