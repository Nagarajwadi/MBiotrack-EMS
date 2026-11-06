import React, { useEffect, useState } from 'react';
import type {
  Office,
  OfficeCreatePayload,
  OfficeUpdatePayload,
} from '../types/office';
import './components.css';

export interface OfficeModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialData?: Office | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: OfficeCreatePayload | OfficeUpdatePayload) => void;
}

interface FormState {
  name: string;
  code: string;
  timezone: string;
  address: string;
  is_active: boolean;
}

interface FormErrors {
  name?: string;
  code?: string;
  timezone?: string;
}

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function getInitialFormState(mode: 'create' | 'edit', initialData?: Office | null): FormState {
  if (mode === 'edit' && initialData) {
    return {
      name: initialData.name,
      code: initialData.code,
      timezone: initialData.timezone,
      address: initialData.address || '',
      is_active: initialData.is_active,
    };
  }
  return {
    name: '',
    code: '',
    timezone: 'Asia/Kolkata',
    address: '',
    is_active: true,
  };
}

export const OfficeModal: React.FC<OfficeModalProps> = ({
  isOpen,
  mode,
  initialData,
  isSubmitting = false,
  serverError,
  onClose,
  onSubmit,
}) => {
  const [trackedTarget, setTrackedTarget] = useState({
    open: isOpen,
    mode,
    id: initialData?.id,
  });
  const [form, setForm] = useState<FormState>(getInitialFormState(mode, initialData));
  const [errors, setErrors] = useState<FormErrors>({});

  if (
    trackedTarget.open !== isOpen ||
    trackedTarget.mode !== mode ||
    trackedTarget.id !== initialData?.id
  ) {
    setTrackedTarget({ open: isOpen, mode, id: initialData?.id });
    setForm(getInitialFormState(mode, initialData));
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
    if (!form.name.trim()) errs.name = 'Office name is required.';
    if (!form.code.trim()) errs.code = 'Office code is required.';
    if (!form.timezone.trim()) errs.timezone = 'Timezone is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (mode === 'create') {
      const payload: OfficeCreatePayload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        timezone: form.timezone.trim(),
        address: form.address.trim() || null,
        is_active: form.is_active,
      };
      onSubmit(payload);
    } else {
      const payload: OfficeUpdatePayload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        timezone: form.timezone.trim(),
        address: form.address.trim() || null,
        is_active: form.is_active,
      };
      onSubmit(payload);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-modal-title"
    >
      <div className="modal-container office-modal-container">
        <div className="modal-header">
          <h3 id="office-modal-title">
            {mode === 'create' ? 'Add New Office' : 'Edit Office'}
          </h3>
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
              <label htmlFor="office-name" className="form-label">
                Office Name <span className="text-danger">*</span>
              </label>
              <input
                id="office-name"
                type="text"
                className={`form-input ${errors.name ? 'input-error' : ''}`}
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
                placeholder="e.g. Headquarters"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'office-name-error' : undefined}
                disabled={isSubmitting}
                autoFocus
              />
              {errors.name && (
                <span id="office-name-error" className="field-error">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="office-code" className="form-label">
                Office Code <span className="text-danger">*</span>
              </label>
              <input
                id="office-code"
                type="text"
                className={`form-input ${errors.code ? 'input-error' : ''}`}
                value={form.code}
                onChange={(e) => {
                  setForm({ ...form, code: e.target.value });
                  if (errors.code) setErrors({ ...errors, code: undefined });
                }}
                placeholder="e.g. HQ-01"
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? 'office-code-error' : undefined}
                disabled={isSubmitting}
              />
              {errors.code && (
                <span id="office-code-error" className="field-error">
                  {errors.code}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="office-timezone" className="form-label">
                Timezone (IANA) <span className="text-danger">*</span>
              </label>
              <input
                id="office-timezone"
                type="text"
                list="timezones-list"
                className={`form-input ${errors.timezone ? 'input-error' : ''}`}
                value={form.timezone}
                onChange={(e) => {
                  setForm({ ...form, timezone: e.target.value });
                  if (errors.timezone) setErrors({ ...errors, timezone: undefined });
                }}
                placeholder="e.g. Asia/Kolkata"
                aria-invalid={Boolean(errors.timezone)}
                aria-describedby={errors.timezone ? 'office-tz-error' : undefined}
                disabled={isSubmitting}
              />
              <datalist id="timezones-list">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              {errors.timezone && (
                <span id="office-tz-error" className="field-error">
                  {errors.timezone}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="office-address" className="form-label">
                Address / Location Notes
              </label>
              <textarea
                id="office-address"
                className="form-input"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="e.g. Floor 4, Tower B, Electronic City"
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  disabled={isSubmitting}
                />
                <span>Active Location</span>
              </label>
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
                  ? 'Add Office'
                  : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
