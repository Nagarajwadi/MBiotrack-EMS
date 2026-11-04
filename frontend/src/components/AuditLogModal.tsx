import React, { useCallback, useEffect, useState } from 'react';
import { getAuditLogs } from '../api/auditApi';
import type { AuditLog } from '../types/audit';
import './components.css';

export interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 15;

export const AuditLogModal: React.FC<AuditLogModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [offset, setOffset] = useState<number>(0);
  const [actionFilter, setActionFilter] = useState<string>('');
  const [targetTypeFilter, setTargetTypeFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Manual refresh or retry handler
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getAuditLogs({
        limit: PAGE_SIZE,
        offset,
        action: actionFilter || undefined,
        target_type: targetTypeFilter || undefined,
      });
      setLogs(response.items);
      setTotal(response.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve audit trail.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [offset, actionFilter, targetTypeFilter]);

  // Synchronize with backend when modal is opened or pagination / filter state changes
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    getAuditLogs({
      limit: PAGE_SIZE,
      offset,
      action: actionFilter || undefined,
      target_type: targetTypeFilter || undefined,
    })
      .then((response) => {
        if (!isMounted) return;
        setLogs(response.items);
        setTotal(response.total);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to retrieve audit trail.';
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, offset, actionFilter, targetTypeFilter]);

  const handleClose = useCallback(() => {
    setOffset(0);
    setActionFilter('');
    setTargetTypeFilter('');
    setError(null);
    onClose();
  }, [onClose]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) {
    return null;
  }

  const handlePrevPage = () => {
    setIsLoading(true);
    setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  };

  const handleNextPage = () => {
    setIsLoading(true);
    setOffset((prev) => prev + PAGE_SIZE);
  };

  const handleActionChange = (val: string) => {
    setIsLoading(true);
    setActionFilter(val);
    setOffset(0);
  };

  const handleTargetTypeChange = (val: string) => {
    setIsLoading(true);
    setTargetTypeFilter(val);
    setOffset(0);
  };

  const handleClearFilters = () => {
    setIsLoading(true);
    setActionFilter('');
    setTargetTypeFilter('');
    setOffset(0);
  };

  const startRecord = total === 0 ? 0 : offset + 1;
  const endRecord = Math.min(offset + PAGE_SIZE, total);

  const getActionBadgeClass = (action: string) => {
    if (action.includes('CREATE') || action.includes('BOOTSTRAP')) return 'badge-create';
    if (action.includes('UPDATE') || action.includes('RESET')) return 'badge-update';
    if (action.includes('DELETE') || action.includes('DEACTIVATE') || action.includes('FAILED'))
      return 'badge-danger';
    return 'badge-info';
  };

  const renderMetadata = (meta: Record<string, unknown> | null) => {
    if (!meta || Object.keys(meta).length === 0) {
      return <span className="text-muted">—</span>;
    }
    return (
      <div className="audit-meta-tags">
        {Object.entries(meta).map(([key, val]) => (
          <span key={key} className="meta-tag">
            <strong>{key}:</strong>{' '}
            {Array.isArray(val)
              ? val.join(', ')
              : typeof val === 'object' && val !== null
                ? JSON.stringify(val)
                : String(val)}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="modal-dialog modal-dialog-audit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-modal-title"
      >
        <div className="modal-header">
          <div className="audit-header-title">
            <h2 id="audit-modal-title">Compliance Audit Trail</h2>
            <span className="audit-admin-pill">ADMINISTRATOR ONLY</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Close audit log dialog"
          >
            ×
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="audit-filter-toolbar">
          <div className="audit-filters-group">
            <label htmlFor="audit-action-filter" className="sr-only">
              Filter by Action
            </label>
            <select
              id="audit-action-filter"
              className="audit-filter-select"
              value={actionFilter}
              onChange={(e) => handleActionChange(e.target.value)}
              aria-label="Filter audit logs by action"
            >
              <option value="">All Actions</option>
              <option value="AUTH_LOGIN_SUCCESS">AUTH_LOGIN_SUCCESS</option>
              <option value="AUTH_LOGIN_FAILED">AUTH_LOGIN_FAILED</option>
              <option value="AUTH_ADMIN_BOOTSTRAP">AUTH_ADMIN_BOOTSTRAP</option>
              <option value="AUTH_ADMIN_PASSWORD_RESET">AUTH_ADMIN_PASSWORD_RESET</option>
              <option value="EMPLOYEE_CREATE">EMPLOYEE_CREATE</option>
              <option value="EMPLOYEE_UPDATE">EMPLOYEE_UPDATE</option>
              <option value="EMPLOYEE_DEACTIVATE">EMPLOYEE_DEACTIVATE</option>
            </select>

            <label htmlFor="audit-target-filter" className="sr-only">
              Filter by Target Type
            </label>
            <select
              id="audit-target-filter"
              className="audit-filter-select"
              value={targetTypeFilter}
              onChange={(e) => handleTargetTypeChange(e.target.value)}
              aria-label="Filter audit logs by target type"
            >
              <option value="">All Target Types</option>
              <option value="user">User</option>
              <option value="employee">Employee</option>
              <option value="auth">Auth</option>
            </select>

            {(actionFilter || targetTypeFilter) && (
              <button
                type="button"
                className="btn-clear-filters"
                onClick={handleClearFilters}
              >
                Clear Filters
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-refresh-audit"
            onClick={() => void fetchLogs()}
            disabled={isLoading}
            title="Refresh audit logs"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body audit-modal-body">
          {error && (
            <div className="alert-banner error" role="alert">
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{error}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void fetchLogs()}
              >
                Retry
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="audit-loading-container" role="status" aria-live="polite">
              <div className="loading-spinner" aria-hidden="true" />
              <p>Loading compliance audit records...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="audit-empty-container" role="status">
              <div className="empty-icon" aria-hidden="true">
                📋
              </div>
              <h3>No Audit Records Found</h3>
              <p>
                {actionFilter || targetTypeFilter
                  ? 'No records match your selected filter criteria.'
                  : 'No audit records have been generated yet.'}
              </p>
            </div>
          ) : (
            <div className="audit-table-wrapper" tabIndex={0} aria-label="Audit records table">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Action</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Target</th>
                    <th scope="col">IP Address</th>
                    <th scope="col">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="audit-cell-ts">
                        <time dateTime={log.created_at}>
                          {new Date(log.created_at).toLocaleString(undefined, {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })}
                        </time>
                      </td>
                      <td>
                        <span className={`audit-badge ${getActionBadgeClass(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="audit-cell-actor">
                        {log.actor_email ? (
                          <span title={`User ID: ${log.actor_user_id}`}>{log.actor_email}</span>
                        ) : log.actor_user_id ? (
                          <span>User #{log.actor_user_id}</span>
                        ) : (
                          <span className="text-muted">System / Anonymous</span>
                        )}
                      </td>
                      <td className="audit-cell-target">
                        <span className="target-type">{log.target_type}</span>
                        {log.target_id && (
                          <span className="target-id" title={log.target_id}>
                            #{log.target_id}
                          </span>
                        )}
                      </td>
                      <td className="audit-cell-ip">
                        {log.ip_address ? <code>{log.ip_address}</code> : <span className="text-muted">—</span>}
                      </td>
                      <td className="audit-cell-meta">{renderMetadata(log.metadata)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer with Pagination */}
        <div className="modal-footer audit-modal-footer">
          <div className="audit-pagination-info">
            Showing <strong>{startRecord}</strong> to <strong>{endRecord}</strong> of{' '}
            <strong>{total}</strong> audit entries
          </div>
          <div className="audit-pagination-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handlePrevPage}
              disabled={offset === 0 || isLoading}
              aria-label="Previous page of audit logs"
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleNextPage}
              disabled={offset + PAGE_SIZE >= total || isLoading}
              aria-label="Next page of audit logs"
            >
              Next
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
