import React, { useEffect, useMemo, useState } from 'react';
import {
  getUsers,
  createUser,
  updateUserStatus,
  updateUserRole,
  resetUserPassword,
} from '../api/userManagementApi';
import { getEmployees } from '../api/employeeApi';
import type { User } from '../types/auth';
import type { Employee } from '../types/employee';
import type {
  PasswordResetPayload,
  UserAccount,
  UserCreatePayload,
  UserRoleUpdatePayload,
} from '../types/userManagement';
import { UserCreateModal } from './UserCreateModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import { UserRoleModal } from './UserRoleModal';
import './components.css';

export interface UserManagementViewProps {
  currentUser: User;
  sessionEpoch: number;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
}) => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserAccount | null>(null);
  const [roleChangeUser, setRoleChangeUser] = useState<UserAccount | null>(null);
  const [isUpdatingStatusId, setIsUpdatingStatusId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    Promise.all([getUsers(), getEmployees()])
      .then(([usersData, employeesData]) => {
        if (!isMounted) return;
        setUsers(usersData);
        setEmployees(employeesData);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to load user management data.';
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const existingUserEmployeeIds = useMemo(() => {
    const ids = new Set<number>();
    users.forEach((u) => {
      if (u.employee_id) ids.add(u.employee_id);
    });
    return ids;
  }, [users]);

  // Metrics
  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active && u.employee_is_active !== false).length;
    const disabled = users.filter((u) => !u.is_active).length;
    const inactiveEmployees = users.filter((u) => u.is_active && u.employee_is_active === false).length;
    const admins = users.filter((u) => u.role === 'ADMIN').length;
    const managers = users.filter((u) => u.role === 'MANAGER').length;
    const employeeRole = users.filter((u) => u.role === 'EMPLOYEE').length;
    return { total, active, disabled, inactiveEmployees, admins, managers, employeeRole };
  }, [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && (!u.is_active || u.employee_is_active === false)) return false;
      if (statusFilter === 'DISABLED' && u.is_active) return false;
      if (statusFilter === 'INACTIVE_EMPLOYEE' && (!u.is_active || u.employee_is_active !== false)) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = u.full_name.toLowerCase().includes(query);
        const matchesEmail = u.email.toLowerCase().includes(query);
        const matchesCode = (u.employee_code || '').toLowerCase().includes(query);
        const matchesDept = (u.department || '').toLowerCase().includes(query);
        if (!matchesName && !matchesEmail && !matchesCode && !matchesDept) {
          return false;
        }
      }

      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  const handleCreateUser = async (payload: UserCreatePayload) => {
    const created = await createUser(payload);
    setUsers((prev) => [...prev, created]);
    setFeedback({
      type: 'success',
      message: `Account for "${created.full_name}" provisioned successfully.`,
    });
  };

  const handleResetPassword = async (userId: number, payload: PasswordResetPayload) => {
    const res = await resetUserPassword(userId, payload);
    const target = users.find((u) => u.id === userId);
    setFeedback({
      type: 'success',
      message: res.message || `Password for "${target?.full_name || 'user'}" has been reset successfully.`,
    });
  };

  const handleUpdateRole = async (userId: number, payload: UserRoleUpdatePayload) => {
    const updated = await updateUserRole(userId, payload);
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: updated.role, updated_at: updated.updated_at } : u))
    );
    setFeedback({
      type: 'success',
      message: `Role for "${updated.full_name}" changed to ${updated.role} successfully.`,
    });
  };

  const handleToggleStatus = async (userItem: UserAccount) => {
    if (userItem.id === currentUser.id && userItem.is_active) {
      setFeedback({
        type: 'error',
        message: 'Administrators cannot disable their own account.',
      });
      return;
    }

    const newStatus = !userItem.is_active;
    setIsUpdatingStatusId(userItem.id);
    setFeedback(null);

    try {
      const updated = await updateUserStatus(userItem.id, { is_active: newStatus });
      setUsers((prev) =>
        prev.map((u) => (u.id === userItem.id ? { ...u, is_active: updated.is_active } : u))
      );
      setFeedback({
        type: 'success',
        message: `Account for "${userItem.full_name}" is now ${newStatus ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFeedback({ type: 'error', message: err.message });
      } else {
        setFeedback({ type: 'error', message: 'Failed to update account status.' });
      }
    } finally {
      setIsUpdatingStatusId(null);
    }
  };

  const handleResetFilters = () => {
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
  };

  return (
    <div className="management-view" data-testid="user-management-view">
      <div className="management-header">
        <div>
          <h2>User Account Management</h2>
          <p className="text-secondary">
            Provision and manage login credentials and account access for staff.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setFeedback(null);
            setIsCreateModalOpen(true);
          }}
        >
          + Provision Account
        </button>
      </div>

      {feedback && (
        <div
          className={`alert-banner ${
            feedback.type === 'success' ? 'alert-banner-success' : 'alert-banner-error'
          }`}
          role="status"
        >
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="alert-banner alert-banner-error" role="alert">
          {error}
        </div>
      )}

      {/* Metrics Bar */}
      <div className="management-metrics-grid">
        <div className="metric-card">
          <div className="metric-value">{metrics.total}</div>
          <div className="metric-label">Total Accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-success">{metrics.active}</div>
          <div className="metric-label">Active Accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-warning">{metrics.disabled}</div>
          <div className="metric-label">Disabled Accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-danger">{metrics.inactiveEmployees}</div>
          <div className="metric-label">Inactive Employees</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-primary">{metrics.admins}</div>
          <div className="metric-label">Administrators</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-info">{metrics.managers}</div>
          <div className="metric-label">Managers</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-secondary">{metrics.employeeRole}</div>
          <div className="metric-label">Employees</div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="directory-controls">
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder="Search by name, email, employee code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search user accounts"
          />
        </div>

        <div className="filter-group">
          <label htmlFor="user-role-filter">Role:</label>
          <select
            id="user-role-filter"
            className="form-control"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MANAGER">MANAGER</option>
            <option value="EMPLOYEE">EMPLOYEE</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="user-status-filter">Status:</label>
          <select
            id="user-status-filter"
            className="form-control"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
            <option value="INACTIVE_EMPLOYEE">Inactive Employee</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading user accounts...</p>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>No user accounts found matching current criteria.</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="empty-state" data-testid="filtered-empty-state">
          <p>User accounts exist, but none match the current search or filter criteria.</p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: '0.75rem' }}
            onClick={handleResetFilters}
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="employee-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Linked Employee</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((item) => {
                const isSelf = item.id === currentUser.id;
                const isUpdating = isUpdatingStatusId === item.id;

                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.full_name}</strong>
                      {isSelf && <span className="badge badge-info ms-1">You</span>}
                    </td>
                    <td>{item.email}</td>
                    <td>
                      <span className={`user-role-badge role-${item.role.toLowerCase()}`}>
                        {item.role}
                      </span>
                    </td>
                    <td>
                      {item.employee_code ? (
                        <span>
                          {item.employee_code} ({item.department || 'N/A'})
                        </span>
                      ) : (
                        <span className="text-muted">Standalone Admin</span>
                      )}
                    </td>
                    <td>
                      {!item.is_active ? (
                        <span className="status-pill status-pill-absent">
                          Disabled
                        </span>
                      ) : item.employee_is_active === false ? (
                        <span
                          className="status-pill status-pill-warning"
                          title="Linked employee record is inactive or deleted"
                        >
                          Inactive Employee
                        </span>
                      ) : (
                        <span className="status-pill status-pill-present">
                          Active
                        </span>
                      )}
                    </td>
                    <td>{new Date(item.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => setResetPasswordUser(item)}
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={isSelf || item.role === 'ADMIN'}
                          onClick={() => setRoleChangeUser(item)}
                          title={
                            isSelf
                              ? 'Cannot change own role'
                              : item.role === 'ADMIN'
                              ? 'Administrator role cannot be changed'
                              : undefined
                          }
                        >
                          Change Role
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${item.is_active ? 'btn-secondary' : 'btn-primary'}`}
                          disabled={isUpdating || (isSelf && item.is_active)}
                          onClick={() => handleToggleStatus(item)}
                          title={isSelf && item.is_active ? 'Cannot disable own account' : undefined}
                        >
                          {isUpdating
                            ? 'Updating...'
                            : item.is_active
                            ? 'Disable'
                            : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      <UserCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateUser}
        employees={employees}
        existingUserEmployeeIds={existingUserEmployeeIds}
      />

      {/* Reset Password Modal */}
      <ResetPasswordModal
        isOpen={Boolean(resetPasswordUser)}
        user={resetPasswordUser}
        onClose={() => setResetPasswordUser(null)}
        onSubmit={handleResetPassword}
      />

      {/* Change Role Modal */}
      <UserRoleModal
        isOpen={Boolean(roleChangeUser)}
        user={roleChangeUser}
        onClose={() => setRoleChangeUser(null)}
        onSubmit={handleUpdateRole}
      />
    </div>
  );
};
