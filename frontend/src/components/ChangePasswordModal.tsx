import React, { useState } from 'react';
import { changePassword } from '../api/authApi';
import { ApiError } from '../api/apiError';
import './components.css';

export interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
      if (onSuccess) {
        onSuccess(
          res.message || 'Password updated successfully. Please log in with your new credentials.'
        );
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to change password. Please try again.');
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
      aria-labelledby="change-password-modal-title"
    >
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="change-password-modal-title">Change Password</h2>
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

            <div className="form-group mb-3">
              <label htmlFor="current-password-input">Current Password *</label>
              <input
                id="current-password-input"
                type="password"
                className="form-control"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group mb-3">
              <label htmlFor="new-password-input">New Password *</label>
              <input
                id="new-password-input"
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
              <label htmlFor="confirm-password-input">Confirm New Password *</label>
              <input
                id="confirm-password-input"
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
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
              {isSubmitting ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
