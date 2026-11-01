import React, { useEffect, useState } from 'react';
import type {
  Employee,
  EmployeeCreatePayload,
  EmployeeUpdatePayload,
} from '../types/employee';
import './components.css';

export interface EmployeeModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialData?: Employee | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  canDeactivate?: boolean;
  onClose: () => void;
  onSubmit: (payload: EmployeeCreatePayload | EmployeeUpdatePayload) => void;
}

interface FormState {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  designation: string;
  joining_date: string;
  is_active: boolean;
}

interface FormErrors {
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  department?: string;
  designation?: string;
  joining_date?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getInitialFormState(
  mode: 'create' | 'edit',
  initialData?: Employee | null
): FormState {
  if (mode === 'edit' && initialData) {
    return {
      employee_code: initialData.employee_code,
      first_name: initialData.first_name,
      last_name: initialData.last_name,
      email: initialData.email,
      department: initialData.department,
      designation: initialData.designation,
      joining_date: initialData.joining_date,
      is_active: initialData.is_active,
    };
  }
  return {
    employee_code: '',
    first_name: '',
    last_name: '',
    email: '',
    department: '',
    designation: '',
    joining_date: getTodayIsoDate(),
    is_active: true,
  };
}

export const EmployeeModal: React.FC<EmployeeModalProps> = ({
  isOpen,
  mode,
  initialData,
  isSubmitting = false,
  serverError = null,
  canDeactivate = true,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState<FormState>(() =>
    getInitialFormState(mode, initialData)
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [trackedTarget, setTrackedTarget] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: number;
  }>({ open: isOpen, mode, id: initialData?.id });

  // Adjust state during render when modal opens or target employee changes
  // Follows official React pattern for adjusting state based on props:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (
    trackedTarget.open !== isOpen ||
    trackedTarget.mode !== mode ||
    trackedTarget.id !== initialData?.id
  ) {
    setTrackedTarget({ open: isOpen, mode, id: initialData?.id });
    setFormData(getInitialFormState(mode, initialData));
    setErrors({});
  }

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};

    if (mode === 'create') {
      const code = formData.employee_code.trim();
      if (!code) {
        nextErrors.employee_code = 'Employee code is required.';
      } else if (code.length > 30) {
        nextErrors.employee_code = 'Employee code cannot exceed 30 characters.';
      }
    }

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

    const email = formData.email.trim();
    if (!email) {
      nextErrors.email = 'Email address is required.';
    } else if (!EMAIL_REGEX.test(email)) {
      nextErrors.email = 'Please enter a valid email address.';
    } else if (email.length > 255) {
      nextErrors.email = 'Email address cannot exceed 255 characters.';
    }

    const dept = formData.department.trim();
    if (!dept) {
      nextErrors.department = 'Department is required.';
    } else if (dept.length > 100) {
      nextErrors.department = 'Department cannot exceed 100 characters.';
    }

    const desig = formData.designation.trim();
    if (!desig) {
      nextErrors.designation = 'Designation is required.';
    } else if (desig.length > 100) {
      nextErrors.designation = 'Designation cannot exceed 100 characters.';
    }

    if (!formData.joining_date) {
      nextErrors.joining_date = 'Joining date is required.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (!validate()) {
      return;
    }

    if (mode === 'create') {
      const createPayload: EmployeeCreatePayload = {
        employee_code: formData.employee_code.trim(),
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim().toLowerCase(),
        department: formData.department.trim(),
        designation: formData.designation.trim(),
        joining_date: formData.joining_date,
        is_active: formData.is_active,
      };
      onSubmit(createPayload);
    } else {
      const updatePayload: EmployeeUpdatePayload = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim().toLowerCase(),
        department: formData.department.trim(),
        designation: formData.designation.trim(),
        joining_date: formData.joining_date,
        is_active: formData.is_active,
      };
      onSubmit(updatePayload);
    }
  };

  const handleFieldChange = (
    field: keyof FormState,
    value: string | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
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
        aria-labelledby="employee-modal-title"
      >
        <div className="modal-header">
          <h2 id="employee-modal-title">
            {mode === 'create' ? 'Add New Employee' : 'Edit Employee'}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {serverError && (
              <div className="server-error-banner" role="alert">
                <span aria-hidden="true">⚠️</span>
                <span>{serverError}</span>
              </div>
            )}

            <div className="form-grid">
              {/* Employee Code */}
              <div className="form-group col-span-2">
                <label htmlFor="emp-code">
                  Employee Code
                  {mode === 'create' && <span className="required-mark">*</span>}
                </label>
                <input
                  id="emp-code"
                  type="text"
                  className={`form-input ${errors.employee_code ? 'has-error' : ''}`}
                  value={formData.employee_code}
                  onChange={(e) => handleFieldChange('employee_code', e.target.value)}
                  disabled={mode === 'edit' || isSubmitting}
                  placeholder="e.g. EMP-101"
                  required={mode === 'create'}
                  aria-invalid={!!errors.employee_code}
                  aria-describedby={
                    errors.employee_code
                      ? 'emp-code-error'
                      : mode === 'edit'
                        ? 'emp-code-hint'
                        : undefined
                  }
                />
                {mode === 'edit' && (
                  <span id="emp-code-hint" className="form-hint">
                    Employee code is immutable and cannot be changed.
                  </span>
                )}
                {errors.employee_code && (
                  <span id="emp-code-error" className="form-error-text">
                    {errors.employee_code}
                  </span>
                )}
              </div>

              {/* First Name */}
              <div className="form-group">
                <label htmlFor="emp-first-name">
                  First Name <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-first-name"
                  type="text"
                  className={`form-input ${errors.first_name ? 'has-error' : ''}`}
                  value={formData.first_name}
                  onChange={(e) => handleFieldChange('first_name', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Jane"
                  required
                  aria-invalid={!!errors.first_name}
                  aria-describedby={errors.first_name ? 'emp-first-name-error' : undefined}
                />
                {errors.first_name && (
                  <span id="emp-first-name-error" className="form-error-text">
                    {errors.first_name}
                  </span>
                )}
              </div>

              {/* Last Name */}
              <div className="form-group">
                <label htmlFor="emp-last-name">
                  Last Name <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-last-name"
                  type="text"
                  className={`form-input ${errors.last_name ? 'has-error' : ''}`}
                  value={formData.last_name}
                  onChange={(e) => handleFieldChange('last_name', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Doe"
                  required
                  aria-invalid={!!errors.last_name}
                  aria-describedby={errors.last_name ? 'emp-last-name-error' : undefined}
                />
                {errors.last_name && (
                  <span id="emp-last-name-error" className="form-error-text">
                    {errors.last_name}
                  </span>
                )}
              </div>

              {/* Email */}
              <div className="form-group col-span-2">
                <label htmlFor="emp-email">
                  Email Address <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-email"
                  type="email"
                  className={`form-input ${errors.email ? 'has-error' : ''}`}
                  value={formData.email}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. jane.doe@company.com"
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'emp-email-error' : undefined}
                />
                {errors.email && (
                  <span id="emp-email-error" className="form-error-text">
                    {errors.email}
                  </span>
                )}
              </div>

              {/* Department */}
              <div className="form-group">
                <label htmlFor="emp-department">
                  Department <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-department"
                  type="text"
                  className={`form-input ${errors.department ? 'has-error' : ''}`}
                  value={formData.department}
                  onChange={(e) => handleFieldChange('department', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Engineering"
                  required
                  aria-invalid={!!errors.department}
                  aria-describedby={errors.department ? 'emp-department-error' : undefined}
                />
                {errors.department && (
                  <span id="emp-department-error" className="form-error-text">
                    {errors.department}
                  </span>
                )}
              </div>

              {/* Designation */}
              <div className="form-group">
                <label htmlFor="emp-designation">
                  Designation <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-designation"
                  type="text"
                  className={`form-input ${errors.designation ? 'has-error' : ''}`}
                  value={formData.designation}
                  onChange={(e) => handleFieldChange('designation', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Senior Software Engineer"
                  required
                  aria-invalid={!!errors.designation}
                  aria-describedby={errors.designation ? 'emp-designation-error' : undefined}
                />
                {errors.designation && (
                  <span id="emp-designation-error" className="form-error-text">
                    {errors.designation}
                  </span>
                )}
              </div>

              {/* Joining Date */}
              <div className="form-group">
                <label htmlFor="emp-joining-date">
                  Joining Date <span className="required-mark">*</span>
                </label>
                <input
                  id="emp-joining-date"
                  type="date"
                  className={`form-input ${errors.joining_date ? 'has-error' : ''}`}
                  value={formData.joining_date}
                  onChange={(e) => handleFieldChange('joining_date', e.target.value)}
                  disabled={isSubmitting}
                  required
                  aria-invalid={!!errors.joining_date}
                  aria-describedby={errors.joining_date ? 'emp-joining-date-error' : undefined}
                />
                {errors.joining_date && (
                  <span id="emp-joining-date-error" className="form-error-text">
                    {errors.joining_date}
                  </span>
                )}
              </div>

              {/* Active Status */}
              <div className="form-group">
                <label>Employment Status</label>
                <div className="checkbox-group">
                  <input
                    id="emp-active"
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => handleFieldChange('is_active', e.target.checked)}
                    disabled={isSubmitting || (mode === 'edit' && !canDeactivate)}
                  />
                  <label htmlFor="emp-active">
                    Active Employee
                  </label>
                </div>
                {mode === 'edit' && !canDeactivate && (
                  <span className="form-hint">
                    Only administrators can change employment status.
                  </span>
                )}
              </div>
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
                  ? 'Add Employee'
                  : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
