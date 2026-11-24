import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEmployee,
  deleteEmployee,
  getEmployees,
  getHealth,
  reactivateEmployee,
  updateEmployee,
} from './api/employeeApi';
import {
  type ActiveView,
  type BackendStatus,
  AttendanceView,
  AuditLogModal,
  DeleteModal,
  EmployeeDashboardView,
  EmployeeModal,
  EmployeeProfileView,
  EmployeeTable,
  Header,
  LeaveAndHolidayView,
  LoginForm,
  ManagementView,
  ManagerTeamAttendanceView,
  ReactivateModal,
  UserManagementView,
} from './components';
import { useAuth } from './context/useAuth';
import {
  ApiError,
  type Employee,
  type EmployeeCreatePayload,
  type EmployeeStatusFilter,
  type EmployeeUpdatePayload,
} from './types/employee';
import {
  canCreateEmployee,
  canDeactivateEmployee,
  canManageUsers,
  canReactivateEmployee,
  canViewAuditTrail,
  canViewDirectory,
  canViewManagement,
  canViewOwnProfile,
  canViewTeamAttendance,
} from './utils/permissions';

import './components/components.css';
import './App.css';

interface FeedbackMessage {
  type: 'success' | 'error';
  message: string;
}

function App() {
  const {
    user,
    status: authStatus,
    isAuthenticated,
    sessionEpoch,
    logout,
    restorationError,
    retryRestoration,
  } = useAuth();

  // Primary application state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  // Role-aware view state
  const [viewPreference, setViewPreference] = useState<ActiveView>('directory');

  const hasDirectoryAccess = canViewDirectory(user?.role);
  const hasProfileAccess = canViewOwnProfile(user);
  const hasManagementAccess = canViewManagement(user?.role);
  const hasTeamAttendanceAccess = canViewTeamAttendance(user?.role);
  const hasUserManagementAccess = canManageUsers(user?.role);

  // Determine effective view based on permissions and preference
  let activeView: ActiveView = 'directory';
  if (!hasDirectoryAccess) {
    if (viewPreference === 'dashboard') {
      activeView = 'dashboard';
    } else if (viewPreference === 'leaves') {
      activeView = 'leaves';
    } else if (viewPreference === 'attendance') {
      activeView = 'attendance';
    } else {
      activeView = 'profile';
    }
  } else if (viewPreference === 'team-attendance' && hasTeamAttendanceAccess) {
    activeView = 'team-attendance';
  } else if (viewPreference === 'dashboard') {
    activeView = 'dashboard';
  } else if (viewPreference === 'management' && hasManagementAccess) {
    activeView = 'management';
  } else if (viewPreference === 'users' && hasUserManagementAccess) {
    activeView = 'users';
  } else if (viewPreference === 'leaves') {
    activeView = 'leaves';
  } else if (!hasProfileAccess) {
    activeView = viewPreference === 'attendance' ? 'attendance' : 'directory';
  } else {
    activeView = viewPreference;
  }

  // Synchronous tracking refs to protect against stale closures & cross-session leakage
  const sessionEpochRef = useRef<number>(sessionEpoch);
  const isAuthenticatedRef = useRef<boolean>(isAuthenticated);
  const isSubmittingRef = useRef<boolean>(false);
  const needsDirectoryReloadRef = useRef<boolean>(false);
  const isManualLogoutRef = useRef<boolean>(false);
  const prevAuthRef = useRef<boolean>(isAuthenticated);

  // Synchronize refs within effect rather than during render
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
    isAuthenticatedRef.current = isAuthenticated;
  }, [sessionEpoch, isAuthenticated]);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState<EmployeeStatusFilter>('ALL');

  // Employee modal state (Create / Edit)
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalServerError, setModalServerError] = useState<string | null>(null);

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Reactivate modal state
  const [isReactivateModalOpen, setIsReactivateModalOpen] = useState<boolean>(false);
  const [reactivatingEmployee, setReactivatingEmployee] = useState<Employee | null>(null);
  const [isReactivating, setIsReactivating] = useState<boolean>(false);

  // Compliance audit trail modal state (ADMIN only)
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  // User feedback notification

  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  // Auto-dismiss feedback notification after 5 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Handle session expiration detection when user becomes unauthenticated without manual logout
  useEffect(() => {
    if (prevAuthRef.current && !isAuthenticated && !isManualLogoutRef.current) {
      setFeedback({
        type: 'error',
        message: 'Your session has expired. Please sign in again.',
      });
      setIsAuditModalOpen(false);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);


  // Fetch employees list from API with strict sessionEpoch protection (for manual refresh)
  const fetchEmployees = useCallback(
    async (isSilent = false, statusOverride?: EmployeeStatusFilter): Promise<boolean> => {
      if (!canViewDirectory(user?.role)) {
        return false;
      }
      const requestEpoch = sessionEpochRef.current;
      setIsLoading(true);

      try {
        const queryStatus = statusOverride ?? (user?.role === 'ADMIN' ? employeeStatusFilter : undefined);
        const data = await getEmployees(queryStatus);

        // Discard response if session epoch changed or user logged out
        if (requestEpoch !== sessionEpochRef.current || !isAuthenticatedRef.current) {
          return false;
        }

        setEmployees(data);
        // Prevent departmentFilter from remaining stuck on an obsolete department
        setDepartmentFilter((currentDept) => {
          if (currentDept === 'ALL') return 'ALL';
          const exists = data.some(
            (emp) => emp.department && emp.department.trim() === currentDept
          );
          return exists ? currentDept : 'ALL';
        });
        needsDirectoryReloadRef.current = false;
        return true;
      } catch (err) {
        if (requestEpoch !== sessionEpochRef.current || !isAuthenticatedRef.current) {
          return false;
        }
        needsDirectoryReloadRef.current = true;
        if (!isSilent) {
          const message =
            err instanceof ApiError
              ? err.message
              : 'Failed to load employee records from backend service.';
          setFeedback({ type: 'error', message });
        }
        return false;
      } finally {
        if (requestEpoch === sessionEpochRef.current && isAuthenticatedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [user, employeeStatusFilter]
  );

  // Backend health check polling (always unauthenticated) with recovery reload
  useEffect(() => {
    let isMounted = true;

    const performHealthCheck = () => {
      getHealth()
        .then((res) => {
          if (!isMounted) return;
          const isOnline = Boolean(res && res.status === 'ok');
          setBackendStatus(isOnline ? 'online' : 'offline');

          if (
            isOnline &&
            needsDirectoryReloadRef.current &&
            isAuthenticatedRef.current &&
            canViewDirectory(user?.role)
          ) {
            needsDirectoryReloadRef.current = false;
            void fetchEmployees(true).then((ok) => {
              if (ok && isMounted) {
                setFeedback(null);
              }
            });
          }
        })
        .catch(() => {
          if (isMounted) {
            setBackendStatus('offline');
            needsDirectoryReloadRef.current = true;
          }
        });
    };

    performHealthCheck();
    const interval = window.setInterval(performHealthCheck, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [fetchEmployees, user?.role]);

  // Load employee directory whenever user transitions to authenticated or status filter changes
  useEffect(() => {
    if (!isAuthenticated || !canViewDirectory(user?.role)) {
      return;
    }

    let isMounted = true;
    getEmployees(user?.role === 'ADMIN' ? employeeStatusFilter : undefined)
      .then((data) => {
        if (isMounted && sessionEpochRef.current === sessionEpoch) {
          setEmployees(data);
          setIsLoading(false);
          needsDirectoryReloadRef.current = false;
        }
      })
      .catch((err) => {
        if (isMounted && sessionEpochRef.current === sessionEpoch) {
          needsDirectoryReloadRef.current = true;
          const message =
            err instanceof ApiError
              ? err.message
              : 'Failed to load employee records from backend service.';
          setFeedback({ type: 'error', message });
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, user?.role, sessionEpoch, employeeStatusFilter]);

  // Unique sorted list of departments for dropdown filter
  const departments = useMemo(() => {
    const deptSet = new Set<string>();
    employees.forEach((emp) => {
      const trimmed = emp.department ? emp.department.trim() : '';
      if (trimmed) {
        deptSet.add(trimmed);
      }
    });
    return Array.from(deptSet).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  // Ensure department filter does not remain stuck on an obsolete department
  const activeDepartmentFilter = useMemo(() => {
    if (departmentFilter === 'ALL') return 'ALL';
    return departments.includes(departmentFilter) ? departmentFilter : 'ALL';
  }, [departmentFilter, departments]);

  // Filtered employee list based on search query and department dropdown
  const filteredEmployees = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (activeDepartmentFilter !== 'ALL' && emp.department !== activeDepartmentFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        emp.employee_code.toLowerCase().includes(query) ||
        emp.first_name.toLowerCase().includes(query) ||
        emp.last_name.toLowerCase().includes(query) ||
        emp.email.toLowerCase().includes(query) ||
        emp.department.toLowerCase().includes(query) ||
        emp.designation.toLowerCase().includes(query)
      );
    });
  }, [employees, searchQuery, activeDepartmentFilter]);

  // Summary counts
  const totalEmployees = employees.length;
  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.is_active).length,
    [employees]
  );
  const inactiveEmployees = totalEmployees - activeEmployees;

  // Open modal for creating a new employee
  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedEmployee(null);
    setModalServerError(null);
    setIsEmployeeModalOpen(true);
  };

  // Open modal for editing an existing employee
  const handleOpenEditModal = (employee: Employee) => {
    setModalMode('edit');
    setSelectedEmployee(employee);
    setModalServerError(null);
    setIsEmployeeModalOpen(true);
  };

  // Close employee modal
  const handleCloseEmployeeModal = () => {
    if (isSubmitting || isSubmittingRef.current) return;
    setIsEmployeeModalOpen(false);
    setSelectedEmployee(null);
    setModalServerError(null);
  };

  // Handle employee modal submit (Create or Edit)
  const handleEmployeeModalSubmit = async (
    payload: EmployeeCreatePayload | EmployeeUpdatePayload
  ) => {
    if (isSubmittingRef.current || isSubmitting) {
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setModalServerError(null);
    try {
      if (modalMode === 'create') {
        const newEmp = await createEmployee(payload as EmployeeCreatePayload);
        setIsEmployeeModalOpen(false);
        const refreshOk = await fetchEmployees(true);
        if (refreshOk) {
          setFeedback({
            type: 'success',
            message: `Employee ${newEmp.first_name} ${newEmp.last_name} (${newEmp.employee_code}) was created successfully.`,
          });
        } else {
          setFeedback({
            type: 'error',
            message: `Employee ${newEmp.first_name} ${newEmp.last_name} (${newEmp.employee_code}) was saved successfully, but the directory could not be refreshed. Please retry.`,
          });
        }
      } else if (selectedEmployee) {
        const updatedEmp = await updateEmployee(
          selectedEmployee.id,
          payload as EmployeeUpdatePayload
        );
        setIsEmployeeModalOpen(false);
        setSelectedEmployee(null);
        const refreshOk = await fetchEmployees(true);
        if (refreshOk) {
          setFeedback({
            type: 'success',
            message: `Employee ${updatedEmp.first_name} ${updatedEmp.last_name} (${updatedEmp.employee_code}) was updated successfully.`,
          });
        } else {
          setFeedback({
            type: 'error',
            message: `Employee ${updatedEmp.first_name} ${updatedEmp.last_name} (${updatedEmp.employee_code}) was saved successfully, but the directory could not be refreshed. Please retry.`,
          });
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setModalServerError(err.message);
      } else {
        setModalServerError('An unexpected error occurred. Please try again.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Open delete confirmation modal
  const handleOpenDeleteModal = (employee: Employee) => {
    setDeletingEmployee(employee);
    setIsDeleteModalOpen(true);
  };

  // Close delete confirmation modal
  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    setIsDeleteModalOpen(false);
    setDeletingEmployee(null);
  };

  // Confirm employee deletion
  const handleConfirmDelete = async () => {
    if (!deletingEmployee || isDeleting) return;
    setIsDeleting(true);
    const name = `${deletingEmployee.first_name} ${deletingEmployee.last_name}`;
    const code = deletingEmployee.employee_code;
    try {
      await deleteEmployee(deletingEmployee.id);
      setIsDeleteModalOpen(false);
      setDeletingEmployee(null);
      const refreshOk = await fetchEmployees(true);
      if (refreshOk) {
        setFeedback({
          type: 'success',
          message: `Employee ${name} (${code}) was deleted successfully.`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: `Employee ${name} (${code}) was deleted successfully, but the directory could not be refreshed. Please retry.`,
        });
      }
    } catch (err) {
      setIsDeleteModalOpen(false);
      setDeletingEmployee(null);
      const message =
        err instanceof ApiError
          ? err.message
          : `Failed to delete employee ${name}.`;
      setFeedback({
        type: 'error',
        message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Open reactivate confirmation modal
  const handleOpenReactivateModal = (employee: Employee) => {
    setReactivatingEmployee(employee);
    setIsReactivateModalOpen(true);
  };

  // Close reactivate confirmation modal
  const handleCloseReactivateModal = () => {
    if (isReactivating) return;
    setIsReactivateModalOpen(false);
    setReactivatingEmployee(null);
  };

  // Confirm employee reactivation
  const handleConfirmReactivate = async () => {
    if (!reactivatingEmployee || isReactivating) return;
    setIsReactivating(true);
    const name = `${reactivatingEmployee.first_name} ${reactivatingEmployee.last_name}`;
    const code = reactivatingEmployee.employee_code;
    try {
      await reactivateEmployee(reactivatingEmployee.id);
      setIsReactivateModalOpen(false);
      setReactivatingEmployee(null);
      const refreshOk = await fetchEmployees(true);
      if (refreshOk) {
        setFeedback({
          type: 'success',
          message: `Employee ${name} (${code}) was reactivated successfully.`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: `Employee ${name} (${code}) was reactivated successfully, but the directory could not be refreshed. Please retry.`,
        });
      }
    } catch (err) {
      setIsReactivateModalOpen(false);
      setReactivatingEmployee(null);
      const message =
        err instanceof ApiError
          ? err.message
          : `Failed to reactivate employee ${name}.`;
      setFeedback({
        type: 'error',
        message,
      });
    } finally {
      setIsReactivating(false);
    }
  };

  // Handle user-initiated sign out
  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    isManualLogoutRef.current = true;
    try {
      await logout();
      setEmployees([]);
      setIsAuditModalOpen(false);
      setFeedback({

        type: 'success',
        message: 'You have been signed out on this device.',
      });
    } finally {
      setIsLoggingOut(false);
      isManualLogoutRef.current = false;
    }
  };

  return (
    <div className="app-container">
      <Header
        status={backendStatus}
        user={user}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        activeView={activeView}
        onNavigate={setViewPreference}
      />

      {authStatus === 'restoring' ? (
        <div className="login-card-container">
          <div style={{ width: '100%', maxWidth: '440px' }}>
            {restorationError ? (
              <div className="table-state-container" style={{ padding: '2rem 1rem' }}>
                <div
                  className="alert-banner error"
                  role="alert"
                  aria-live="assertive"
                  style={{ marginBottom: '1.5rem', textAlign: 'left' }}
                >
                  <div className="alert-content">
                    <span>⚠️</span>
                    <span>{restorationError}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  {retryRestoration && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void retryRestoration()}
                    >
                      Retry Connection
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void logout()}
                  >
                    Sign In Again
                  </button>
                </div>
              </div>
            ) : (
              <div className="table-state-container" style={{ padding: '3rem 1rem' }}>
                <div className="table-spinner" role="status" aria-label="Restoring session" />
                <div className="table-state-title">Restoring Session</div>
                <div className="table-state-description">
                  Verifying your session with the server...
                </div>
              </div>
            )}
          </div>
        </div>
      ) : !isAuthenticated ? (
        <div className="login-card-container">
          <div style={{ width: '100%', maxWidth: '440px' }}>
            {feedback && (
              <div
                className={`alert-banner ${feedback.type}`}
                role="status"
                aria-live="polite"
              >
                <div className="alert-content">
                  <span>{feedback.type === 'success' ? '✓' : '⚠️'}</span>
                  <span>{feedback.message}</span>
                </div>
                <button
                  type="button"
                  className="alert-close"
                  aria-label="Close notification"
                  onClick={() => setFeedback(null)}
                >
                  ×
                </button>
              </div>
            )}
            <LoginForm
              onLoginSuccess={() => {
                setFeedback(null);
              }}
            />
          </div>
        </div>
      ) : activeView === 'management' && user && hasManagementAccess ? (
        <ManagementView
          currentUser={user}
          sessionEpoch={sessionEpoch}
          onNavigateToDirectory={() => setViewPreference('directory')}
        />
      ) : activeView === 'users' && user && hasUserManagementAccess ? (
        <UserManagementView
          currentUser={user}
          sessionEpoch={sessionEpoch}
        />
      ) : activeView === 'dashboard' && user ? (
        <EmployeeDashboardView
          currentUser={user}
          sessionEpoch={sessionEpoch}
          onNavigateToAttendance={() => setViewPreference('attendance')}
          onNavigateToLeaves={() => setViewPreference('leaves')}
          onNavigateToProfile={
            hasProfileAccess ? () => setViewPreference('profile') : undefined
          }
          onNavigateToDirectory={
            hasDirectoryAccess ? () => setViewPreference('directory') : undefined
          }
        />
      ) : activeView === 'leaves' && user ? (
        <LeaveAndHolidayView
          currentUser={user}
          sessionEpoch={sessionEpoch}
          onNavigateToDirectory={
            hasDirectoryAccess ? () => setViewPreference('directory') : undefined
          }
          onNavigateToProfile={
            hasProfileAccess ? () => setViewPreference('profile') : undefined
          }
          onNavigateToAttendance={() => setViewPreference('attendance')}
          onNavigateToDashboard={() => setViewPreference('dashboard')}
        />
      ) : activeView === 'team-attendance' && user ? (
        <ManagerTeamAttendanceView
          currentUser={user}
          sessionEpoch={sessionEpoch}
          onNavigateToDirectory={
            hasDirectoryAccess ? () => setViewPreference('directory') : undefined
          }
          onNavigateToAttendance={() => setViewPreference('attendance')}
          onNavigateToLeaves={() => setViewPreference('leaves')}
        />
      ) : activeView === 'attendance' && user ? (
        <AttendanceView
          currentUser={user}
          sessionEpoch={sessionEpoch}
          onNavigateToDirectory={
            hasDirectoryAccess ? () => setViewPreference('directory') : undefined
          }
          onNavigateToProfile={
            hasProfileAccess ? () => setViewPreference('profile') : undefined
          }
          onNavigateToLeaves={() => setViewPreference('leaves')}
          onNavigateToDashboard={() => setViewPreference('dashboard')}
        />
      ) : activeView === 'profile' ? (
        <main className="dashboard-wrapper">
          {user?.role === 'EMPLOYEE' && (
            <div className="employee-subnav" role="tablist" aria-label="Employee navigation">
              <button
                type="button"
                role="tab"
                aria-selected="false"
                className="nav-tab-btn"
                onClick={() => setViewPreference('dashboard')}
              >
                📊 Dashboard
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="true"
                className="nav-tab-btn active"
              >
                My Profile
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                className="nav-tab-btn"
                onClick={() => setViewPreference('attendance')}
              >
                My Attendance
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                className="nav-tab-btn"
                onClick={() => setViewPreference('leaves')}
              >
                Leaves & Holidays
              </button>
            </div>
          )}
          {feedback && (
            <div
              className={`alert-banner ${feedback.type}`}
              role="status"
              aria-live="polite"
            >
              <div className="alert-content">
                <span>{feedback.type === 'success' ? '✓' : '⚠️'}</span>
                <span>{feedback.message}</span>
              </div>
              <button
                type="button"
                className="alert-close"
                aria-label="Close notification"
                onClick={() => setFeedback(null)}
              >
                ×
              </button>
            </div>
          )}
          {user?.employee_id !== null && user?.employee_id !== undefined ? (
            <EmployeeProfileView
              employeeId={user.employee_id}
              currentUser={user}
              sessionEpoch={sessionEpoch}
              onProfileUpdated={() => {
                if (canViewDirectory(user?.role)) {
                  void fetchEmployees(true);
                }
              }}
              onPasswordChanged={async () => {
                await logout();
                setFeedback({
                  type: 'success',
                  message: 'Password updated successfully. Please log in with your new credentials.',
                });
              }}
            />
          ) : (
            <div className="profile-container">
              <div className="alert-banner error" role="alert">
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>
                    Your user account is not linked to an employee staff profile. Please contact an
                    administrator to link your account.
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      ) : (
        <main className="dashboard-wrapper">
          {/* Intro / Page Title */}
          <div className="dashboard-header-section">
            <div className="dashboard-heading">
              <h2>Employee Directory</h2>
              <p>Manage employee records, organizational departments, and account statuses.</p>
            </div>
            <div className="dashboard-actions-group">
              {hasProfileAccess && (
                <button
                  type="button"
                  className="btn btn-secondary btn-dashboard"
                  onClick={() => setViewPreference('dashboard')}
                  title="View personal employee dashboard"
                >
                  📊 My Dashboard
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-attendance"
                onClick={() => setViewPreference('attendance')}
                title="View normalized attendance punch records"
              >
                📅 Attendance
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-leaves"
                onClick={() => setViewPreference('leaves')}
                title="View leave requests and holiday calendar"
              >
                🌴 Leaves & Holidays
              </button>
              {hasManagementAccess && (
                <button
                  type="button"
                  className="btn btn-secondary btn-management"
                  onClick={() => setViewPreference('management')}
                  title="Manage offices, devices, and employee assignments"
                >
                  🏢 Offices & Devices
                </button>
              )}
              {canViewAuditTrail(user?.role) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-audit-trail"
                  onClick={() => setIsAuditModalOpen(true)}
                  title="View compliance and security audit trail"
                >
                  📋 Audit Trail
                </button>
              )}
              {canCreateEmployee(user?.role) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleOpenCreateModal}
                >
                  + Add Employee
                </button>
              )}
            </div>
          </div>


          {/* Global Feedback Banner */}
          {feedback && (
            <div
              className={`alert-banner ${feedback.type}`}
              role="status"
              aria-live="polite"
            >
              <div className="alert-content">
                <span>{feedback.type === 'success' ? '✓' : '⚠️'}</span>
                <span>{feedback.message}</span>
              </div>
              <button
                type="button"
                className="alert-close"
                aria-label="Close notification"
                onClick={() => setFeedback(null)}
              >
                ×
              </button>
            </div>
          )}

          {/* Summary Metrics */}
          <section className="summary-grid" aria-label="Employee summary metrics">
            <div className="summary-card">
              <div className="summary-icon total" aria-hidden="true">
                👥
              </div>
              <div className="summary-info">
                <h3>Total Employees</h3>
                <div className="summary-value">{totalEmployees}</div>
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-icon active" aria-hidden="true">
                ✓
              </div>
              <div className="summary-info">
                <h3>Active Staff</h3>
                <div className="summary-value">{activeEmployees}</div>
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-icon inactive" aria-hidden="true">
                ⏸
              </div>
              <div className="summary-info">
                <h3>Inactive Staff</h3>
                <div className="summary-value">{inactiveEmployees}</div>
              </div>
            </div>
          </section>

          {/* Search & Filter Toolbar */}
          <section className="toolbar-card" aria-label="Filters and controls">
            <div className="toolbar-filters">
              <div className="search-input-wrapper">
                <span className="search-icon" aria-hidden="true">
                  🔍
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by code, name, email, department..."
                  aria-label="Search employees"
                />
              </div>

              <select
                className="filter-select"
                value={activeDepartmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                aria-label="Filter by department"
              >
                <option value="ALL">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>

              {user?.role === 'ADMIN' && (
                <select
                  className="filter-select"
                  value={employeeStatusFilter}
                  onChange={(e) => setEmployeeStatusFilter(e.target.value as EmployeeStatusFilter)}
                  aria-label="Filter by employment status"
                  data-testid="employee-status-filter"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active Employees</option>
                  <option value="INACTIVE">Deactivated Employees</option>
                </select>
              )}

              {(searchQuery || activeDepartmentFilter !== 'ALL' || (user?.role === 'ADMIN' && employeeStatusFilter !== 'ALL')) && (
                <button
                  type="button"
                  className="btn-clear-filters"
                  onClick={() => {
                    setSearchQuery('');
                    setDepartmentFilter('ALL');
                    setEmployeeStatusFilter('ALL');
                  }}
                  data-testid="clear-employee-filters-btn"
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className="toolbar-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void fetchEmployees();
                }}
                disabled={isLoading}
                title="Refresh employee data"
              >
                🔄 Refresh
              </button>
            </div>
          </section>

          {/* Employee Table */}
          <EmployeeTable
            employees={filteredEmployees}
            isLoading={isLoading}
            totalCount={totalEmployees}
            canDeactivate={canDeactivateEmployee(user?.role)}
            canReactivate={canReactivateEmployee(user?.role)}
            onClearFilters={() => {
              setSearchQuery('');
              setDepartmentFilter('ALL');
              setEmployeeStatusFilter('ALL');
            }}
            onEdit={handleOpenEditModal}
            onDelete={handleOpenDeleteModal}
            onReactivate={handleOpenReactivateModal}
          />
        </main>
      )}

      {/* Employee Modal (Create/Edit) */}
      {isAuthenticated && (
        <>
          <EmployeeModal
            isOpen={isEmployeeModalOpen}
            mode={modalMode}
            initialData={selectedEmployee}
            isSubmitting={isSubmitting}
            serverError={modalServerError}
            canDeactivate={canDeactivateEmployee(user?.role)}
            onClose={handleCloseEmployeeModal}
            onSubmit={handleEmployeeModalSubmit}
          />

          <DeleteModal
            isOpen={isDeleteModalOpen}
            employee={deletingEmployee}
            isDeleting={isDeleting}
            onClose={handleCloseDeleteModal}
            onConfirm={handleConfirmDelete}
          />

          <ReactivateModal
            isOpen={isReactivateModalOpen}
            employee={reactivatingEmployee}
            isReactivating={isReactivating}
            onClose={handleCloseReactivateModal}
            onConfirm={handleConfirmReactivate}
          />

          {canViewAuditTrail(user?.role) && (
            <AuditLogModal
              isOpen={isAuditModalOpen}
              onClose={() => setIsAuditModalOpen(false)}
            />
          )}
        </>
      )}

    </div>
  );
}

export default App;
