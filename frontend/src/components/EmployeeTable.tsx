import React from 'react';
import type { Employee } from '../types/employee';
import './components.css';

export interface EmployeeTableProps {
  employees: Employee[];
  isLoading: boolean;
  totalCount?: number;
  canDeactivate?: boolean;
  canReactivate?: boolean;
  onClearFilters?: () => void;
  onEdit: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
  onReactivate?: (employee: Employee) => void;
}

export const EmployeeTable: React.FC<EmployeeTableProps> = ({
  employees,
  isLoading,
  totalCount,
  canDeactivate = true,
  canReactivate = false,
  onClearFilters,
  onEdit,
  onDelete,
  onReactivate,
}) => {
  if (isLoading) {
    return (
      <div className="table-card" aria-busy="true" aria-live="polite">
        <div className="table-state-container">
          <div className="table-spinner" role="progressbar" aria-label="Loading employees" />
          <div className="table-state-title">Loading Employee Records...</div>
          <div className="table-state-description">Connecting to database service</div>
        </div>
      </div>
    );
  }

  if (employees.length === 0) {
    const isFiltered = totalCount !== undefined && totalCount > 0;

    return (
      <div className="table-card" role="region" aria-label="Employees list">
        <div className="table-state-container">
          <div className="table-state-icon" aria-hidden="true">
            {isFiltered ? '🔍' : '📋'}
          </div>
          <div className="table-state-title">
            {isFiltered ? 'No Matching Employees' : 'No Employees Found'}
          </div>
          <div className="table-state-description">
            {isFiltered
              ? 'No employees match your search criteria. Try clearing your filters.'
              : 'Get started by adding your first employee to the system.'}
          </div>
          {isFiltered && onClearFilters && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.75rem' }}
              onClick={onClearFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="table-card" role="region" aria-label="Employees list">
      <div className="table-responsive">
        <table className="employee-table">
          <thead>
            <tr>
              <th scope="col">Employee ID</th>
              <th scope="col">Employee Name</th>
              <th scope="col">Email</th>
              <th scope="col">Department</th>
              <th scope="col">Designation</th>
              <th scope="col">Joining Date</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td>
                  <span className="employee-code-badge" title={`Internal ID: ${emp.id}`}>
                    {emp.employee_code}
                  </span>
                </td>
                <td>
                  <div className="employee-name">
                    {emp.first_name} {emp.last_name}
                  </div>
                </td>
                <td>
                  <span className="employee-email">{emp.email}</span>
                </td>
                <td>{emp.department}</td>
                <td>{emp.designation}</td>
                <td>
                  <time dateTime={emp.joining_date}>{emp.joining_date}</time>
                </td>
                <td>
                  <span
                    className={`status-badge ${emp.is_active && !emp.deleted_at ? 'active' : 'inactive'}`}
                    role="status"
                    data-testid={`employee-status-badge-${emp.id}`}
                  >
                    {emp.is_active && !emp.deleted_at ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="actions-cell">
                    {emp.is_active && !emp.deleted_at ? (
                      <>
                        <button
                          type="button"
                          className="btn-action-edit"
                          onClick={() => onEdit(emp)}
                          aria-label={`Edit ${emp.first_name} ${emp.last_name} (${emp.employee_code})`}
                          data-testid={`edit-employee-btn-${emp.id}`}
                        >
                          Edit
                        </button>
                        {canDeactivate && (
                          <button
                            type="button"
                            className="btn-action-delete"
                            onClick={() => onDelete(emp)}
                            aria-label={`Delete ${emp.first_name} ${emp.last_name} (${emp.employee_code})`}
                            data-testid={`delete-employee-btn-${emp.id}`}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {canReactivate && onReactivate && (
                          <button
                            type="button"
                            className="btn-action-reactivate"
                            onClick={() => onReactivate(emp)}
                            aria-label={`Reactivate ${emp.first_name} ${emp.last_name} (${emp.employee_code})`}
                            data-testid={`reactivate-employee-btn-${emp.id}`}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.8rem',
                              borderRadius: '4px',
                              border: '1px solid #16a34a',
                              backgroundColor: '#f0fdf4',
                              color: '#15803d',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-action-edit"
                          onClick={() => onEdit(emp)}
                          aria-label={`Edit ${emp.first_name} ${emp.last_name} (${emp.employee_code})`}
                          data-testid={`edit-employee-btn-${emp.id}`}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

