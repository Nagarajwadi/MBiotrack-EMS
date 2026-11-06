import React, { useEffect, useState } from 'react';
import type { Office } from '../types/office';
import type {
  HolidayCreatePayload,
  HolidayDetail,
  HolidayUpdatePayload,
} from '../types/holiday';
import './components.css';

export interface HolidayModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  offices: Office[];
  initialData?: HolidayDetail | null;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: HolidayCreatePayload | HolidayUpdatePayload) => void;
}

interface FormState {
  holiday_date: string;
  name: string;
  description: string;
  office_id: string; // empty string = org-wide (null)
  is_optional: boolean;
}

interface FormErrors {
  holiday_date?: string;
  name?: string;
}

const getTodayUtc = () => new Date().toISOString().split('T')[0];

function getInitialFormState(
  mode: 'create' | 'edit',
  initialData?: HolidayDetail | null
): FormState {
  if (mode === 'edit' && initialData) {
    return {
      holiday_date: initialData.holiday_date,
      name: initialData.name,
      description: initialData.description || '',
      office_id: initialData.office_id != null ? String(initialData.office_id) : '',
      is_optional: initialData.is_optional,
    };
  }
  return {
    holiday_date: getTodayUtc(),
    name: '',
    description: '',
    office_id: '',
    is_optional: false,
  };
}

export const HolidayModal: React.FC<HolidayModalProps> = ({
  isOpen,
  mode,
  offices,
  initialData,
  isSubmitting = false,
  serverError = null,
  onClose,
  onSubmit,
}) => {
  const [trackedTarget, setTrackedTarget] = useState({
    open: isOpen,
    mode,
    id: initialData?.id,
  });
  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(mode, initialData)
  );
  const [errors, setErrors] = useState<FormErrors>({});

  if (
    trackedTarget.open !== isOpen ||
    trackedTarget.mode !== mode ||
    trackedTarget.id !== initialData?.id
  ) {
    setTrackedTarget({ open: isOpen, mode, id: initialData?.id });
    setFormState(getInitialFormState(mode, initialData));
    setErrors({});
  }

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.holiday_date.trim()) {
      newErrors.holiday_date = 'Holiday date is required.';
    }
    if (!formState.name.trim()) {
      newErrors.name = 'Holiday name is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const officeIdNum = formState.office_id.trim()
      ? parseInt(formState.office_id.trim(), 10)
      : null;

    if (mode === 'create') {
      const payload: HolidayCreatePayload = {
        holiday_date: formState.holiday_date,
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
        office_id: officeIdNum,
        is_optional: formState.is_optional,
      };
      onSubmit(payload);
    } else {
      const payload: HolidayUpdatePayload = {
        holiday_date: formState.holiday_date,
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
        office_id: officeIdNum,
        is_optional: formState.is_optional,
      };
      onSubmit(payload);
    }
  };

  const title = mode === 'create' ? 'Add Holiday' : 'Edit Holiday';

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="holiday-modal-backdrop">
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="holiday-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px' }}
      >
        <div className="modal-header">
          <h2 id="holiday-modal-title" className="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {serverError && (
              <div
                className="error-banner"
                role="alert"
                style={{ marginBottom: '16px' }}
                data-testid="holiday-modal-server-error"
              >
                {serverError}
              </div>
            )}

            {/* Holiday Date */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="holiday-date" className="form-label required">
                Holiday Date
              </label>
              <input
                id="holiday-date"
                type="date"
                className={`form-input ${errors.holiday_date ? 'input-error' : ''}`}
                value={formState.holiday_date}
                onChange={(e) => {
                  setFormState((prev) => ({ ...prev, holiday_date: e.target.value }));
                  if (errors.holiday_date) setErrors((prev) => ({ ...prev, holiday_date: undefined }));
                }}
                disabled={isSubmitting}
                required
                data-testid="holiday-date-input"
              />
              {errors.holiday_date && (
                <span className="field-error-text" role="alert">
                  {errors.holiday_date}
                </span>
              )}
            </div>

            {/* Name */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="holiday-name" className="form-label required">
                Holiday Name
              </label>
              <input
                id="holiday-name"
                type="text"
                placeholder="e.g. New Year's Day, Independence Day"
                className={`form-input ${errors.name ? 'input-error' : ''}`}
                value={formState.name}
                onChange={(e) => {
                  setFormState((prev) => ({ ...prev, name: e.target.value }));
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                disabled={isSubmitting}
                required
                data-testid="holiday-name-input"
              />
              {errors.name && (
                <span className="field-error-text" role="alert">
                  {errors.name}
                </span>
              )}
            </div>

            {/* Office Scope */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="holiday-office" className="form-label">
                Office Scope
              </label>
              <select
                id="holiday-office"
                className="form-select"
                value={formState.office_id}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, office_id: e.target.value }))
                }
                disabled={isSubmitting}
                data-testid="holiday-office-select"
              >
                <option value="">🌐 Organization-wide (All Offices)</option>
                {offices.map((office) => (
                  <option key={office.id} value={String(office.id)}>
                    🏢 {office.name} ({office.code})
                  </option>
                ))}
              </select>
              <p
                className="field-hint"
                style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}
              >
                Select an office for branch-specific holidays, or Organization-wide to apply across all offices.
              </p>
            </div>

            {/* Optional Holiday Checkbox */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.9rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={formState.is_optional}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, is_optional: e.target.checked }))
                  }
                  disabled={isSubmitting}
                  data-testid="holiday-optional-checkbox"
                />
                Optional / Restricted Holiday
              </label>
              <p
                className="field-hint"
                style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', marginLeft: '22px' }}
              >
                Check if employees can optionally choose this holiday from an optional holiday list.
              </p>
            </div>

            {/* Description */}
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label htmlFor="holiday-description" className="form-label">
                Description (Optional)
              </label>
              <textarea
                id="holiday-description"
                rows={3}
                placeholder="Optional notes or details about this holiday..."
                className="form-textarea"
                value={formState.description}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, description: e.target.value }))
                }
                disabled={isSubmitting}
                data-testid="holiday-description-input"
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
              data-testid="submit-holiday-btn"
            >
              {isSubmitting
                ? 'Saving...'
                : mode === 'create'
                ? 'Create Holiday'
                : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
