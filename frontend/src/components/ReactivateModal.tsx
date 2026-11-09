import React, { useEffect } from 'react';
import type { Employee } from '../types/employee';
import './components.css';

export interface ReactivateModalProps {
  isOpen: boolean;
  employee: Employee | null;
  isReactivating?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const ReactivateModal: React.FC<ReactivateModalProps> = ({
  isOpen,
  employee,
  isReactivating = false,
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isReactivating) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isReactivating, onClose]);

  if (!isOpen || !employee) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isReactivating) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog modal-dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reactivate-dialog-title"
        aria-describedby="reactivate-dialog-desc"
      >
        <div className="modal-header">
          <h2 id="reactivate-dialog-title">Confirm Reactivation</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isReactivating}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p id="reactivate-dialog-desc" style={{ margin: '0 0 1rem 0', color: '#334155', lineHeight: 1.5 }}>
            Are you sure you want to reactivate{' '}
            <strong>
              {employee.first_name} {employee.last_name}
            </strong>{' '}
            (<span className="employee-code-badge">{employee.employee_code}</span>)?
          </p>
          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#f0fdf4',
              borderRadius: '6px',
              border: '1px solid #bbf7d0',
              fontSize: '0.8125rem',
              color: '#166534',
            }}
          >
            ✓ This will restore the employee to active employment status, permitting system access and attendance tracking.
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isReactivating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isReactivating}
            aria-busy={isReactivating}
            data-testid="confirm-reactivate-btn"
          >
            {isReactivating ? 'Reactivating...' : 'Reactivate Employee'}
          </button>
        </div>
      </div>
    </div>
  );
};
