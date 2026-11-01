import React, { useEffect } from 'react';
import type { Employee } from '../types/employee';
import './components.css';

export interface DeleteModalProps {
  isOpen: boolean;
  employee: Employee | null;
  isDeleting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
  isOpen,
  employee,
  isDeleting = false,
  onClose,
  onConfirm,
}) => {
  // Handle escape key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !employee) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog modal-dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-desc"
      >
        <div className="modal-header">
          <h2 id="delete-dialog-title">Confirm Deletion</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p id="delete-dialog-desc" style={{ margin: '0 0 1rem 0', color: '#334155', lineHeight: 1.5 }}>
            Are you sure you want to permanently delete{' '}
            <strong>
              {employee.first_name} {employee.last_name}
            </strong>{' '}
            (<span className="employee-code-badge">{employee.employee_code}</span>)?
          </p>
          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#fef2f2',
              borderRadius: '6px',
              border: '1px solid #fee2e2',
              fontSize: '0.8125rem',
              color: '#991b1b',
            }}
          >
            ⚠️ This action removes the employee record from the database and cannot be undone.
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
            aria-busy={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Employee'}
          </button>
        </div>
      </div>
    </div>
  );
};

