import React, { useEffect, useState } from 'react';
import { ApiError } from '../api/apiError';
import { getEmployeeBalanceLedger } from '../api/leaveApi';
import type { LeaveBalanceLedgerItem } from '../types/leave';
import './components.css';

export interface LeaveBalanceLedgerModalProps {
  isOpen: boolean;
  employeeId: number | null;
  employeeName?: string | null;
  year?: number;
  onClose: () => void;
}

const formatTransactionType = (type: string): string => {
  const norm = type.toUpperCase();
  switch (norm) {
    case 'INITIAL_ALLOCATION':
      return 'Initial Allocation';
    case 'RESERVATION':
      return 'Reservation (Pending)';
    case 'CONSUMPTION':
      return 'Consumption (Approved)';
    case 'RESERVATION_RELEASE':
      return 'Reservation Release';
    case 'ADJUSTMENT':
      return 'Adjustment';
    default:
      return type.replace(/_/g, ' ');
  }
};

const formatLedgerTimestamp = (isoStr: string | null | undefined): string => {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
};

const CURRENT_YEAR = new Date().getFullYear();

export const LeaveBalanceLedgerModal: React.FC<LeaveBalanceLedgerModalProps> = ({
  isOpen,
  employeeId,
  employeeName,
  year = CURRENT_YEAR,
  onClose,
}) => {
  const [entries, setEntries] = useState<LeaveBalanceLedgerItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !employeeId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setEntries([]);
      // oxlint-disable-next-line react/set-state-in-effect
      setIsLoading(false);
      // oxlint-disable-next-line react/set-state-in-effect
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    getEmployeeBalanceLedger(employeeId, year)
      .then((data) => {
        if (!isMounted) return;
        setEntries(data || []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setEntries([]);
        setIsLoading(false);
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Failed to load leave balance history.'
        );
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, employeeId, year]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const titleEmployee = employeeName ? employeeName : employeeId ? `Employee #${employeeId}` : '';

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="leave-balance-ledger-modal-backdrop"
    >
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-modal-title"
        data-testid="leave-balance-ledger-modal"
        style={{ maxWidth: '780px', width: '90%' }}
      >
        <div className="modal-header">
          <div>
            <h2 id="ledger-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>
              📜 Leave Balance History ({year})
            </h2>
            {titleEmployee && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Transaction ledger for <strong>{titleEmployee}</strong>
              </p>
            )}
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close balance history modal"
            data-testid="ledger-modal-close-btn"
          >
            ×
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {error && (
            <div
              className="alert-banner error"
              role="alert"
              data-testid="ledger-error-banner"
              style={{ marginBottom: '1rem' }}
            >
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {isLoading ? (
            <div
              className="dashboard-loading-state"
              role="status"
              data-testid="ledger-loading-state"
              style={{ padding: '2rem 1rem' }}
            >
              <div className="loading-spinner" aria-hidden="true" />
              <p>Loading balance history transactions...</p>
            </div>
          ) : !error && entries.length === 0 ? (
            <div
              className="empty-state-card"
              data-testid="ledger-empty-state"
              style={{ padding: '2.5rem 1rem', textAlign: 'center' }}
            >
              <p className="empty-title" style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                No balance transactions recorded
              </p>
              <p className="empty-subtitle" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                No leave allocations, reservations, or deductions have been logged for calendar year {year}.
              </p>
            </div>
          ) : !error && (
            <div className="table-responsive">
              <table
                className="data-table"
                data-testid="ledger-table"
                aria-label="Leave balance ledger entries"
              >
                <thead>
                  <tr>
                    <th scope="col">Date & Time</th>
                    <th scope="col">Leave Category</th>
                    <th scope="col">Transaction</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Days Impact</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Request Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((item) => {
                    const isPositive = item.days > 0;
                    const isZero = item.days === 0;
                    const formattedDays = isPositive ? `+${item.days}` : `${item.days}`;

                    return (
                      <tr key={item.id} data-testid={`ledger-row-${item.id}`}>
                        <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                          {formatLedgerTimestamp(item.created_at)}
                        </td>
                        <td>
                          <span
                            className={`badge-leave-type badge-type-${item.leave_type.toLowerCase()}`}
                            data-testid={`ledger-type-${item.id}`}
                          >
                            {item.leave_type}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                            {formatTransactionType(item.transaction_type)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {item.transaction_type}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span
                            data-testid={`ledger-days-${item.id}`}
                            style={{
                              fontWeight: 700,
                              fontSize: '0.95rem',
                              color: isZero ? '#64748b' : isPositive ? '#16a34a' : '#dc2626',
                            }}
                          >
                            {formattedDays} {Math.abs(item.days) === 1 ? 'day' : 'days'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {item.leave_request_id ? (
                            <span
                              className="code-badge"
                              data-testid={`ledger-ref-${item.id}`}
                              title={`Associated Leave Request #${item.leave_request_id}`}
                            >
                              #{item.leave_request_id}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            data-testid="ledger-modal-dismiss-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
