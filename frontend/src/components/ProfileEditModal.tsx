import React, { useEffect, useState } from 'react';
import type { Employee } from '../types/employee';
import './components.css';

export interface ProfileEditModalProps {
  isOpen: boolean;
  employee: Employee | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: { first_name: string; last_name: string }) => void;
}

interface ProfileFormState {
  first_name: string;
  last_name: string;
}

interface ProfileFormErrors {
  first_name?: string;
  last_name?: string;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({
  isOpen,
  employee,
  isSubmitting = false,
  serverError = null,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState<ProfileFormState>({
    first_name: employee?.first_name || '',
    last_name: employee?.last_name || '',
  });
  const [errors, setErrors] = useState<ProfileFormErrors>({});

  // Synchronize initial state when modal opens or employee changes
  const [trackedId, setTrackedId] = useState<number | undefined>(employee?.id);
  if (employee?.id !== trackedId) {
    setTrackedId(employee?.id);
    setFormData({
      first_name: employee?.first_name || '',
      last_name: employee?.last_name || '',
    });
    setErrors({});
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

  if (!isOpen || !employee) {
    return null;
  }

  const validate = (): boolean => {
    const nextErrors: ProfileFormErrors = {};
    const firstName = formData.first_name.trim();
    if (!firstName) {
      nextErrors.first_name = 'First name is required.';
    } else if (firstName.length > 100) {
      nextErrors.first_name = 'First name cannot exceed 100 characters.';
    }

    const lastName = formData.last_name.trim();
    if (!lastName) {
      nextErrors.last_name = 'Last name is required.';
    } else if (lastName.length > 100) {
      nextErrors.last_name = 'Last name cannot exceed 100 characters.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !validate()) {
      return;
    }

    // Strictly send only first_name and last_name as permitted for self-service
    onSubmit({
      first_name: formData.first_name.trim(),
      last_name: formData.last_name.trim(),
    });
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
      >
        <div className="modal-header">
          <h2 id="profile-modal-title">Edit Personal Details</h2>
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

        {serverError && (
          <div className="server-error-banner" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Read-Only Context Labels */}
          <div className="read-only-notice-banner">
            <span aria-hidden="true">ℹ️</span>
            <span>
              Work email and organizational assignments are managed by HR. Only your personal name
              can be edited directly.
            </span>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="pe-code">Employee Code</label>
              <input
                id="pe-code"
                type="text"
                value={employee.employee_code}
                disabled
                className="input-readonly"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pe-email">Work Email</label>
              <input
                id="pe-email"
                type="email"
                value={employee.email}
                disabled
                className="input-readonly"
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="pe-dept">Department</label>
              <input
                id="pe-dept"
                type="text"
                value={employee.department}
                disabled
                className="input-readonly"
              />
            </div>

            <div className="form-group">
              <label htmlFor="pe-desig">Designation</label>
              <input
                id="pe-desig"
                type="text"
                value={employee.designation}
                disabled
                className="input-readonly"
              />
            </div>
          </div>

          {/* Editable Fields: First Name and Last Name */}
          <div className="form-grid-2" style={{ marginTop: '0.5rem' }}>
            <div className="form-group">
              <label htmlFor="pe-first-name">
                First Name <span className="field-required">*</span>
              </label>
              <input
                id="pe-first-name"
                type="text"
                value={formData.first_name}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, first_name: e.target.value }));
                  if (errors.first_name) {
                    setErrors((prev) => ({ ...prev, first_name: undefined }));
                  }
                }}
                disabled={isSubmitting}
                className={errors.first_name ? 'input-error' : ''}
                autoFocus
              />
              {errors.first_name && <span className="field-error-msg">{errors.first_name}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="pe-last-name">
                Last Name <span className="field-required">*</span>
              </label>
              <input
                id="pe-last-name"
                type="text"
                value={formData.last_name}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, last_name: e.target.value }));
                  if (errors.last_name) {
                    setErrors((prev) => ({ ...prev, last_name: undefined }));
                  }
                }}
                disabled={isSubmitting}
                className={errors.last_name ? 'input-error' : ''}
              />
              {errors.last_name && <span className="field-error-msg">{errors.last_name}</span>}
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
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

