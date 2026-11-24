import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelLeaveRequest,
  deleteEntitlementDefault,
  deleteEntitlementOverride,
  getEntitlementDefaults,
  getEntitlementOverrides,
  getLeaveRequest,
  getLeaveRequests,
  reviewLeaveRequest,
  setEntitlementDefault,
  setEntitlementOverride,
  submitLeaveRequest,
} from '../api/leaveApi';
import {
  createHoliday,
  deleteHoliday,
  getHolidays,
  updateHoliday,
} from '../api/holidayApi';
import { getOffices } from '../api/officeApi';
import { getEmployees } from '../api/employeeApi';
import { ApiError } from '../api/apiError';
import type { User } from '../types/auth';
import type { Employee } from '../types/employee';
import type { Office } from '../types/office';
import type {
  EmployeeLeaveEntitlement,
  LeaveEntitlementDefault,
  LeaveFilterParams,
  LeaveRequestCreatePayload,
  LeaveRequestDetail,
  LeaveRequestListResponse,
  LeaveStatus,
  LeaveType,
} from '../types/leave';
import type {
  HolidayCreatePayload,
  HolidayDetail,
  HolidayFilterParams,
  HolidayUpdatePayload,
} from '../types/holiday';
import { canManageHolidays, canReviewLeave } from '../utils/permissions';
import { LeaveModal } from './LeaveModal';
import { HolidayModal } from './HolidayModal';
import { LeaveEntitlementModal } from './LeaveEntitlementModal';
import { LeaveBalanceLedgerModal } from './LeaveBalanceLedgerModal';
import './components.css';

export interface LeaveAndHolidayViewProps {
  currentUser: User;
  sessionEpoch: number;
  initialSubTab?: 'leaves' | 'holidays' | 'entitlements';
  onNavigateToDirectory?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToAttendance?: () => void;
  onNavigateToDashboard?: () => void;
}

const PAGE_SIZE = 20;
const CURRENT_YEAR = new Date().getFullYear();

export const LeaveAndHolidayView: React.FC<LeaveAndHolidayViewProps> = ({
  currentUser,
  sessionEpoch,
  initialSubTab = 'leaves',
  onNavigateToDirectory,
  onNavigateToProfile,
  onNavigateToAttendance,
  onNavigateToDashboard,
}) => {
  const isEmployee = currentUser.role === 'EMPLOYEE';
  const isManager = currentUser.role === 'MANAGER';
  const isAdmin = currentUser.role === 'ADMIN';
  const canReview = canReviewLeave(currentUser.role);
  const canManageHols = canManageHolidays(currentUser.role);

  // Active top-level subtab
  const [activeSubTab, setActiveSubTab] = useState<'leaves' | 'holidays' | 'entitlements'>(initialSubTab);

  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  // Global notification banner inside view
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Offices list for dropdowns
  const [offices, setOffices] = useState<Office[]>([]);
  useEffect(() => {
    let isMounted = true;
    if (isAdmin || currentUser.role === 'MANAGER') {
      getOffices()
        .then((data) => {
          if (isMounted) setOffices(data);
        })
        .catch(() => {
          // Non-critical fallback
        });
    }
    return () => {
      isMounted = false;
    };
  }, [isAdmin, currentUser.role]);

  // =========================================================================
  // Entitlements State (Admin only)
  // =========================================================================
  const [entitlementYear, setEntitlementYear] = useState<number>(CURRENT_YEAR);
  const [entitlementDefaults, setEntitlementDefaults] = useState<LeaveEntitlementDefault[]>([]);
  const [entitlementOverrides, setEntitlementOverrides] = useState<EmployeeLeaveEntitlement[]>([]);
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [isEntitlementsLoading, setIsEntitlementsLoading] = useState<boolean>(false);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);
  const [entitlementReloadTrigger, setEntitlementReloadTrigger] = useState<number>(0);

  // Entitlement Modal State
  const [isEntitlementModalOpen, setIsEntitlementModalOpen] = useState<boolean>(false);
  const [entitlementModalMode, setEntitlementModalMode] = useState<'default' | 'override'>('default');
  const [editingDefault, setEditingDefault] = useState<LeaveEntitlementDefault | null>(null);
  const [editingOverride, setEditingOverride] = useState<EmployeeLeaveEntitlement | null>(null);

  useEffect(() => {
    if (activeSubTab !== 'entitlements' || !isAdmin) return;
    let isMounted = true;

    Promise.all([
      getEntitlementDefaults(entitlementYear),
      getEntitlementOverrides(entitlementYear),
      getEmployees(),
    ])
      .then(([defaultsData, overridesData, empsData]) => {
        if (!isMounted) return;
        setEntitlementDefaults(defaultsData);
        setEntitlementOverrides(overridesData);
        setEmployeesList(empsData);
        setIsEntitlementsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to load entitlements.';
        setEntitlementsError(msg);
        setIsEntitlementsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeSubTab, entitlementYear, entitlementReloadTrigger, isAdmin]);

  const handleSaveDefault = async (payload: { year: number; leave_type: string; allocated_days: number }) => {
    await setEntitlementDefault(payload);
    setFeedback({
      type: 'success',
      message: `Organization default for ${payload.leave_type} in ${payload.year} saved successfully.`,
    });
    setEntitlementReloadTrigger((prev) => prev + 1);
  };

  const handleDeleteDefault = async (defaultId: number) => {
    if (!window.confirm('Are you sure you want to delete this organization default entitlement?')) return;
    try {
      await deleteEntitlementDefault(defaultId);
      setFeedback({ type: 'success', message: 'Default entitlement deleted successfully.' });
      setEntitlementReloadTrigger((prev) => prev + 1);
    } catch (err: unknown) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete default.' });
    }
  };

  const handleSaveOverride = async (payload: { employee_id: number; year: number; leave_type: string; allocated_days: number }) => {
    await setEntitlementOverride(payload);
    setFeedback({
      type: 'success',
      message: `Employee entitlement override saved successfully.`,
    });
    setEntitlementReloadTrigger((prev) => prev + 1);
  };

  const handleDeleteOverride = async (overrideId: number) => {
    if (!window.confirm('Are you sure you want to delete this employee entitlement override?')) return;
    try {
      await deleteEntitlementOverride(overrideId);
      setFeedback({ type: 'success', message: 'Employee override deleted successfully.' });
      setEntitlementReloadTrigger((prev) => prev + 1);
    } catch (err: unknown) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete override.' });
    }
  };

  // =========================================================================
  // 1. Leave Requests State
  // =========================================================================
  const [leaveFilterStatus, setLeaveFilterStatus] = useState<string>('ALL');
  const [leaveFilterType, setLeaveFilterType] = useState<string>('ALL');
  const [leaveFilterDepartment, setLeaveFilterDepartment] = useState<string>('ALL');
  const [leaveFilterStartDate, setLeaveFilterStartDate] = useState<string>('');
  const [leaveFilterEndDate, setLeaveFilterEndDate] = useState<string>('');
  const [leaveFilterEmployeeId, setLeaveFilterEmployeeId] = useState<string>('');

  const [leaveData, setLeaveData] = useState<LeaveRequestListResponse>({
    items: [],
    total: 0,
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [isLeaveLoading, setIsLeaveLoading] = useState<boolean>(true);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaveOffset, setLeaveOffset] = useState<number>(0);
  const [leaveReloadTrigger, setLeaveReloadTrigger] = useState<number>(0);

  // Modals for leaves
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState<boolean>(false);
  const [isLeaveSubmitting, setIsLeaveSubmitting] = useState<boolean>(false);
  const [leaveModalError, setLeaveModalError] = useState<string | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<{ id: number; name?: string | null } | null>(null);

  // Review / Decision Modal (Approve or Reject)
  const [reviewingRequest, setReviewingRequest] = useState<LeaveRequestDetail | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [isReviewSubmitting, setIsReviewSubmitting] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reviewingRequestId = reviewingRequest?.id;
  const reviewingRequestAllocatedDays = reviewingRequest?.allocated_days;

  useEffect(() => {
    if (!reviewingRequestId) return;
    let isMounted = true;
    if (reviewingRequestAllocatedDays === undefined || reviewingRequestAllocatedDays === null) {
      getLeaveRequest(reviewingRequestId)
        .then((detail) => {
          if (isMounted) setReviewingRequest(detail);
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [reviewingRequestId, reviewingRequestAllocatedDays]);

  // Cancel Modal
  const [cancellingRequest, setCancellingRequest] = useState<LeaveRequestDetail | null>(null);
  const [cancelNotes, setCancelNotes] = useState<string>('');
  const [isCancelSubmitting, setIsCancelSubmitting] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Fetch Leaves
  useEffect(() => {
    if (activeSubTab !== 'leaves') return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    const params: LeaveFilterParams = {
      limit: PAGE_SIZE,
      offset: leaveOffset,
    };
    if (leaveFilterStatus !== 'ALL') {
      params.status = leaveFilterStatus as LeaveStatus;
    }
    if (leaveFilterType !== 'ALL') {
      params.leave_type = leaveFilterType as LeaveType;
    }
    if (leaveFilterStartDate.trim()) {
      params.start_date = leaveFilterStartDate.trim();
    }
    if (leaveFilterEndDate.trim()) {
      params.end_date = leaveFilterEndDate.trim();
    }
    if (!isEmployee && leaveFilterEmployeeId.trim()) {
      const empId = parseInt(leaveFilterEmployeeId.trim(), 10);
      if (!isNaN(empId)) {
        params.employee_id = empId;
      }
    }
    if (isAdmin && leaveFilterDepartment !== 'ALL') {
      params.department = leaveFilterDepartment;
    }

    getLeaveRequests(params)
      .then((res) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setLeaveData(res);
        setIsLeaveLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setLeaveError(err instanceof Error ? err.message : 'Failed to load leave requests.');
        setIsLeaveLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeSubTab,
    leaveOffset,
    leaveFilterStatus,
    leaveFilterType,
    leaveFilterDepartment,
    leaveFilterStartDate,
    leaveFilterEndDate,
    leaveFilterEmployeeId,
    isEmployee,
    isAdmin,
    leaveReloadTrigger,
  ]);

  const handleCreateLeaveSubmit = async (payload: LeaveRequestCreatePayload) => {
    setIsLeaveSubmitting(true);
    setLeaveModalError(null);
    try {
      await submitLeaveRequest(payload);
      setIsLeaveModalOpen(false);
      setFeedback({ type: 'success', message: 'Leave request submitted successfully.' });
      setLeaveReloadTrigger((prev) => prev + 1);
    } catch (err) {
      setLeaveModalError(
        err instanceof ApiError ? err.message : 'Failed to submit leave request.'
      );
    } finally {
      setIsLeaveSubmitting(false);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingRequest) return;
    setIsReviewSubmitting(true);
    setReviewError(null);
    try {
      await reviewLeaveRequest(reviewingRequest.id, {
        decision: reviewAction,
        decision_notes: reviewNotes.trim() || undefined,
      });
      setReviewingRequest(null);
      setReviewNotes('');
      setFeedback({
        type: 'success',
        message: `Leave request #${reviewingRequest.id} has been ${
          reviewAction === 'APPROVED' ? 'approved' : 'rejected'
        }.`,
      });
      setLeaveReloadTrigger((prev) => prev + 1);
    } catch (err) {
      setReviewError(
        err instanceof ApiError ? err.message : 'Failed to complete review.'
      );
    } finally {
      setIsReviewSubmitting(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingRequest) return;
    setIsCancelSubmitting(true);
    setCancelError(null);
    try {
      await cancelLeaveRequest(cancellingRequest.id);
      setCancellingRequest(null);
      setCancelNotes('');
      setFeedback({
        type: 'success',
        message: `Leave request #${cancellingRequest.id} has been cancelled.`,
      });
      setLeaveReloadTrigger((prev) => prev + 1);
    } catch (err) {
      setCancelError(
        err instanceof ApiError ? err.message : 'Failed to cancel leave request.'
      );
    } finally {
      setIsCancelSubmitting(false);
    }
  };

  // =========================================================================
  // 2. Holiday Calendar State
  // =========================================================================
  const [holidayOfficeFilter, setHolidayOfficeFilter] = useState<string>('ALL');
  const [holidayStartDate, setHolidayStartDate] = useState<string>('');
  const [holidayEndDate, setHolidayEndDate] = useState<string>('');

  const [holidays, setHolidays] = useState<HolidayDetail[]>([]);
  const [isHolidayLoading, setIsHolidayLoading] = useState<boolean>(true);
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [holidayReloadTrigger, setHolidayReloadTrigger] = useState<number>(0);

  // Modals for holidays
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState<boolean>(false);
  const [holidayModalMode, setHolidayModalMode] = useState<'create' | 'edit'>('create');
  const [selectedHoliday, setSelectedHoliday] = useState<HolidayDetail | null>(null);
  const [isHolidaySubmitting, setIsHolidaySubmitting] = useState<boolean>(false);
  const [holidayModalError, setHolidayModalError] = useState<string | null>(null);

  // Delete Holiday Confirmation
  const [deletingHoliday, setDeletingHoliday] = useState<HolidayDetail | null>(null);
  const [isDeletingHoliday, setIsDeletingHoliday] = useState<boolean>(false);
  const [deleteHolidayError, setDeleteHolidayError] = useState<string | null>(null);

  // Fetch Holidays
  useEffect(() => {
    if (activeSubTab !== 'holidays') return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    const params: HolidayFilterParams = {};
    if (holidayOfficeFilter === 'ORG_WIDE') {
      params.include_org_wide = true;
    } else if (holidayOfficeFilter !== 'ALL') {
      const offId = parseInt(holidayOfficeFilter, 10);
      if (!isNaN(offId)) {
        params.office_id = offId;
        params.include_org_wide = true;
      }
    }
    if (holidayStartDate.trim()) {
      params.start_date = holidayStartDate.trim();
    }
    if (holidayEndDate.trim()) {
      params.end_date = holidayEndDate.trim();
    }

    getHolidays(params)
      .then((res) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        let filteredItems = res.items;
        if (holidayOfficeFilter === 'ORG_WIDE') {
          filteredItems = res.items.filter((h) => h.office_id === null);
        }
        setHolidays(filteredItems);
        setIsHolidayLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setHolidayError(err instanceof Error ? err.message : 'Failed to load holidays.');
        setIsHolidayLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeSubTab,
    holidayOfficeFilter,
    holidayStartDate,
    holidayEndDate,
    holidayReloadTrigger,
  ]);

  const handleHolidayModalSubmit = async (
    payload: HolidayCreatePayload | HolidayUpdatePayload
  ) => {
    setIsHolidaySubmitting(true);
    setHolidayModalError(null);
    try {
      if (holidayModalMode === 'create') {
        await createHoliday(payload as HolidayCreatePayload);
        setFeedback({ type: 'success', message: 'Holiday created successfully.' });
      } else if (selectedHoliday) {
        await updateHoliday(selectedHoliday.id, payload as HolidayUpdatePayload);
        setFeedback({ type: 'success', message: 'Holiday updated successfully.' });
      }
      setIsHolidayModalOpen(false);
      setHolidayReloadTrigger((prev) => prev + 1);
    } catch (err) {
      setHolidayModalError(
        err instanceof ApiError ? err.message : 'Failed to save holiday.'
      );
    } finally {
      setIsHolidaySubmitting(false);
    }
  };

  const handleConfirmDeleteHoliday = async () => {
    if (!deletingHoliday) return;
    setIsDeletingHoliday(true);
    setDeleteHolidayError(null);
    try {
      await deleteHoliday(deletingHoliday.id);
      setDeletingHoliday(null);
      setFeedback({ type: 'success', message: 'Holiday deleted successfully.' });
      setHolidayReloadTrigger((prev) => prev + 1);
    } catch (err) {
      setDeleteHolidayError(
        err instanceof ApiError ? err.message : 'Failed to delete holiday.'
      );
    } finally {
      setIsDeletingHoliday(false);
    }
  };

  // Leave metrics
  const leaveMetrics = useMemo(() => {
    const items = leaveData.items;
    let pending = 0;
    let approved = 0;
    let other = 0;
    for (const item of items) {
      if (item.status === 'PENDING') pending++;
      else if (item.status === 'APPROVED') approved++;
      else other++;
    }
    return {
      total: leaveData.total,
      pending,
      approved,
      other,
    };
  }, [leaveData]);

  // Helpers
  const formatWorkingDays = (days: number | null | undefined) => {
    if (days !== null && days !== undefined) {
      return days === 1 ? '1 working day' : `${days} working days`;
    }
    return 'Legacy — duration unavailable';
  };

  return (
    <main className="dashboard-wrapper">
      {/* Employee Navigation Subnav if role === 'EMPLOYEE' */}
      {isEmployee && (
        <div className="employee-subnav" role="tablist" aria-label="Employee navigation">
          {onNavigateToDashboard && (
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="nav-tab-btn"
              onClick={onNavigateToDashboard}
            >
              Dashboard
            </button>
          )}
          {onNavigateToProfile && (
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="nav-tab-btn"
              onClick={onNavigateToProfile}
            >
              My Profile
            </button>
          )}
          {onNavigateToAttendance && (
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="nav-tab-btn"
              onClick={onNavigateToAttendance}
            >
              My Attendance
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="nav-tab-btn active"
          >
            Leaves & Holidays
          </button>
        </div>
      )}

      {/* Top Header Section */}
      <div className="dashboard-header-section">
        <div className="dashboard-heading">
          <h2>
            Leaves & Holidays
            {isManager && leaveData?.department && (
              <span
                className="team-department-badge"
                data-testid="manager-department-badge"
                style={{
                  marginLeft: '12px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  verticalAlign: 'middle',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  backgroundColor: '#e0e7ff',
                  color: '#3730a3',
                }}
              >
                Department: {leaveData.department}
              </span>
            )}
          </h2>
          <p>
            {isManager
              ? `Manage and review leave requests for your ${leaveData?.department ? `${leaveData.department} ` : ''}team.`
              : 'Manage employee leave requests, approvals, and view organizational holiday calendars.'}
          </p>
        </div>

        <div className="dashboard-actions-group">
          {activeSubTab === 'leaves' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLeaveModalError(null);
                setIsLeaveModalOpen(true);
              }}
              data-testid="request-leave-btn"
            >
              + Request Leave
            </button>
          )}

          {activeSubTab === 'leaves' && isEmployee && currentUser.employee_id && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setLedgerTarget({
                  id: currentUser.employee_id!,
                  name: currentUser.full_name || 'My Balance History',
                })
              }
              data-testid="view-my-balance-history-btn"
              title="View your leave balance transaction history"
            >
              📜 Balance History
            </button>
          )}

          {activeSubTab === 'holidays' && canManageHols && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSelectedHoliday(null);
                setHolidayModalMode('create');
                setHolidayModalError(null);
                setIsHolidayModalOpen(true);
              }}
              data-testid="add-holiday-btn"
            >
              + Add Holiday
            </button>
          )}

          {onNavigateToDirectory && !isEmployee && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onNavigateToDirectory}
              title="Return to Employee Directory"
            >
              👥 Directory
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (activeSubTab === 'leaves') {
                setLeaveReloadTrigger((prev) => prev + 1);
              } else if (activeSubTab === 'holidays') {
                setHolidayReloadTrigger((prev) => prev + 1);
              } else {
                setEntitlementReloadTrigger((prev) => prev + 1);
              }
            }}
            title="Refresh current view"
            data-testid="refresh-view-btn"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`alert-banner ${feedback.type}`}
          role="status"
          aria-live="polite"
          data-testid="feedback-banner"
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

      {/* Unlinked Manager Alert */}
      {isManager && (!currentUser.employee_id || currentUser.employee_id <= 0) && (
        <div
          className="alert-banner error"
          role="alert"
          data-testid="unlinked-manager-warning"
          style={{ marginBottom: '20px' }}
        >
          <div className="alert-content">
            <span>⚠️</span>
            <span>
              Your manager account is not linked to an employee profile. You cannot view or review team leave requests until linked to a department.
            </span>
          </div>
        </div>
      )}

      {/* Primary Subtabs: Leave Requests vs Holiday Calendar */}
      <div
        className="attendance-tabs-container"
        role="tablist"
        aria-label="Leave and Holiday subviews"
        style={{ marginBottom: '20px' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'leaves'}
          className={`attendance-tab-btn ${activeSubTab === 'leaves' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('leaves')}
          data-testid="tab-leave-requests"
        >
          🌴 Leave Requests
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'holidays'}
          className={`attendance-tab-btn ${activeSubTab === 'holidays' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('holidays')}
          data-testid="tab-holiday-calendar"
        >
          📅 Holiday Calendar
        </button>
        {isAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'entitlements'}
            className={`attendance-tab-btn ${activeSubTab === 'entitlements' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('entitlements')}
            data-testid="tab-leave-entitlements"
          >
            📋 Leave Entitlements
          </button>
        )}
      </div>

      {/* =================================================================== */}
      {/* SUBVIEW 1: LEAVE REQUESTS */}
      {/* =================================================================== */}
      {activeSubTab === 'leaves' && (
        <div data-testid="leave-requests-section">
          {/* Summary Cards */}
          <section className="summary-grid" aria-label="Leave summary metrics" style={{ marginBottom: '20px' }}>
            <div className="summary-card">
              <div className="summary-icon total" aria-hidden="true">
                📋
              </div>
              <div className="summary-info">
                <h3>{isManager ? 'Team Requests' : 'Total Requests'}</h3>
                <div className="summary-value" data-testid="metric-total-leaves">
                  {leaveMetrics.total}
                </div>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon inactive" aria-hidden="true">
                ⏳
              </div>
              <div className="summary-info">
                <h3>{isManager ? 'Team Pending' : 'Pending Approval'}</h3>
                <div className="summary-value" data-testid="metric-pending-leaves">
                  {leaveMetrics.pending}
                </div>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon active" aria-hidden="true">
                ✓
              </div>
              <div className="summary-info">
                <h3>{isManager ? 'Team Approved' : 'Approved (This View)'}</h3>
                <div className="summary-value" data-testid="metric-approved-leaves">
                  {leaveMetrics.approved}
                </div>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon offline" aria-hidden="true">
                ✖
              </div>
              <div className="summary-info">
                <h3>Rejected / Cancelled</h3>
                <div className="summary-value" data-testid="metric-other-leaves">
                  {leaveMetrics.other}
                </div>
              </div>
            </div>
          </section>

          {/* Filter Toolbar */}
          <section className="toolbar-card" aria-label="Leave request filters" style={{ marginBottom: '20px' }}>
            <div className="toolbar-filters" style={{ flexWrap: 'wrap', gap: '10px' }}>
              {/* Status Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="leave-status-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Status
                </label>
                <select
                  id="leave-status-filter"
                  className="filter-select"
                  value={leaveFilterStatus}
                  onChange={(e) => {
                    setLeaveFilterStatus(e.target.value);
                    setLeaveOffset(0);
                  }}
                  data-testid="leave-status-filter"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              {/* Leave Type Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="leave-type-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Leave Type
                </label>
                <select
                  id="leave-type-filter"
                  className="filter-select"
                  value={leaveFilterType}
                  onChange={(e) => {
                    setLeaveFilterType(e.target.value);
                    setLeaveOffset(0);
                  }}
                  data-testid="leave-type-filter"
                >
                  <option value="ALL">All Types</option>
                  <option value="ANNUAL">Annual Leave</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="CASUAL">Casual Leave</option>
                  <option value="UNPAID">Unpaid Leave</option>
                </select>
              </div>

              {/* Date Filters */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="leave-start-date" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Start Date From
                </label>
                <input
                  id="leave-start-date"
                  type="date"
                  className="filter-select"
                  value={leaveFilterStartDate}
                  onChange={(e) => {
                    setLeaveFilterStartDate(e.target.value);
                    setLeaveOffset(0);
                  }}
                  data-testid="leave-start-date-filter"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="leave-end-date" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  End Date To
                </label>
                <input
                  id="leave-end-date"
                  type="date"
                  className="filter-select"
                  value={leaveFilterEndDate}
                  onChange={(e) => {
                    setLeaveFilterEndDate(e.target.value);
                    setLeaveOffset(0);
                  }}
                  data-testid="leave-end-date-filter"
                />
              </div>

              {/* Employee ID filter for Manager/Admin */}
              {!isEmployee && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label htmlFor="leave-emp-id-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                    Employee ID
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      id="leave-emp-id-filter"
                      type="number"
                      placeholder="e.g. 1"
                      className="filter-select"
                      style={{ width: '110px' }}
                      value={leaveFilterEmployeeId}
                      onChange={(e) => {
                        setLeaveFilterEmployeeId(e.target.value);
                        setLeaveOffset(0);
                      }}
                      data-testid="leave-employee-id-filter"
                    />
                    {!isNaN(parseInt(leaveFilterEmployeeId.trim(), 10)) && parseInt(leaveFilterEmployeeId.trim(), 10) > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const empId = parseInt(leaveFilterEmployeeId.trim(), 10);
                          setLedgerTarget({ id: empId, name: `Employee #${empId}` });
                        }}
                        data-testid="view-filtered-employee-ledger-btn"
                        title="View balance history for this filtered employee"
                      >
                        📜 Ledger
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Department Filter for Admin */}
              {isAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label htmlFor="leave-department-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                    Department
                  </label>
                  <select
                    id="leave-department-filter"
                    className="filter-select"
                    value={leaveFilterDepartment}
                    onChange={(e) => {
                      setLeaveFilterDepartment(e.target.value);
                      setLeaveOffset(0);
                    }}
                    data-testid="leave-department-filter"
                  >
                    <option value="ALL">All Departments</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Sales">Sales</option>
                    <option value="Support">Support</option>
                    <option value="HR">HR</option>
                    <option value="Finance">Finance</option>
                    <option value="Operations">Operations</option>
                  </select>
                </div>
              )}

              {/* Clear Filters */}
              {(leaveFilterStatus !== 'ALL' ||
                leaveFilterType !== 'ALL' ||
                leaveFilterStartDate ||
                leaveFilterEndDate ||
                leaveFilterEmployeeId ||
                (isAdmin && leaveFilterDepartment !== 'ALL')) && (
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-clear-filters"
                    onClick={() => {
                      setLeaveFilterStatus('ALL');
                      setLeaveFilterType('ALL');
                      setLeaveFilterStartDate('');
                      setLeaveFilterEndDate('');
                      setLeaveFilterEmployeeId('');
                      setLeaveFilterDepartment('ALL');
                      setLeaveOffset(0);
                    }}
                    data-testid="clear-leave-filters-btn"
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Error Banner */}
          {leaveError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '16px' }} data-testid="leave-error-banner">
              <div className="alert-content">
                <span>⚠️</span>
                <span>{leaveError}</span>
              </div>
            </div>
          )}

          {/* Table or Loading */}
          <div className="table-container" style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
            {isLeaveLoading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }} data-testid="leave-loading">
                <span className="spinner" aria-hidden="true" style={{ marginRight: '8px' }} />
                Loading leave requests...
              </div>
            ) : leaveData.items.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }} data-testid="leave-empty-state">
                <p style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '8px' }}>No leave requests found</p>
                <p style={{ fontSize: '0.85rem' }}>
                  {isEmployee
                    ? "You haven't submitted any leave requests yet. Click '+ Request Leave' to submit one."
                    : 'No requests match the selected filters.'}
                </p>
              </div>
            ) : (
              <table className="table" aria-label="Leave requests list" data-testid="leave-table">
                <thead>
                  <tr>
                    {!isEmployee && <th>Employee</th>}
                    <th>Leave Type</th>
                    <th>Dates & Duration</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Decided By / Notes</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveData.items.map((leave) => {
                    const isOwnRequest =
                      currentUser.employee_id !== null &&
                      currentUser.employee_id === leave.employee_id;

                    const canApproveThis = canReview && !isOwnRequest && leave.status === 'PENDING';
                    const canCancelThis =
                      (isEmployee && isOwnRequest && leave.status === 'PENDING') ||
                      (!isEmployee &&
                        (leave.status === 'PENDING' || leave.status === 'APPROVED'));

                    return (
                      <tr key={leave.id} data-testid={`leave-row-${leave.id}`}>
                        {!isEmployee && (
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {leave.employee_name || `Employee #${leave.employee_id}`}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              {leave.employee_code ? `${leave.employee_code} • ` : ''}
                              {leave.department || 'General'}
                            </div>
                          </td>
                        )}
                        <td>
                          <span className={`badge-leave-type badge-type-${leave.leave_type.toLowerCase()}`}>
                            {leave.leave_type}
                          </span>
                        </td>
                        <td>
                          <div>
                            {leave.start_date} → {leave.end_date}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {formatWorkingDays(leave.working_days)}
                          </div>
                        </td>
                        <td style={{ maxWidth: '240px', wordBreak: 'break-word' }}>
                          {leave.reason ? (
                            <span>{leave.reason}</span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No reason provided</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge-leave-status badge-status-${leave.status.toLowerCase()}`}
                            data-testid={`leave-status-badge-${leave.id}`}
                          >
                            {leave.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {leave.decision_by_user_name ? (
                            <div>
                              <span style={{ fontWeight: 500 }}>{leave.decision_by_user_name}</span>
                              {leave.decided_at && (
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                  {leave.decided_at.slice(0, 10)}
                                </div>
                              )}
                              {leave.decision_notes && (
                                <div style={{ color: '#475569', fontStyle: 'italic', marginTop: '2px' }}>
                                  "{leave.decision_notes}"
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            {/* Manager / Admin Review Controls */}
                            {canReview && leave.status === 'PENDING' && (
                              <>
                                {isOwnRequest && (
                                  <span
                                    style={{
                                      fontSize: '0.75rem',
                                      color: '#94a3b8',
                                      fontStyle: 'italic',
                                      padding: '2px 6px',
                                    }}
                                    title="Self-approval is strictly forbidden."
                                    data-testid={`self-approval-blocked-${leave.id}`}
                                  >
                                    Self-approval blocked
                                  </span>
                                )}
                                {canApproveThis && (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-success"
                                      onClick={() => {
                                        setReviewingRequest(leave);
                                        setReviewAction('APPROVED');
                                        setReviewNotes('');
                                        setReviewError(null);
                                      }}
                                      title="Approve this leave request"
                                      data-testid={`approve-leave-btn-${leave.id}`}
                                    >
                                      ✓ Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-danger"
                                      onClick={() => {
                                        setReviewingRequest(leave);
                                        setReviewAction('REJECTED');
                                        setReviewNotes('');
                                        setReviewError(null);
                                      }}
                                      title="Reject this leave request"
                                      data-testid={`reject-leave-btn-${leave.id}`}
                                    >
                                      ✕ Reject
                                    </button>
                                  </>
                                )}
                              </>
                            )}

                            {/* Cancel Option */}
                            {canCancelThis && (
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  setCancellingRequest(leave);
                                  setCancelNotes('');
                                  setCancelError(null);
                                }}
                                title="Cancel this leave request"
                                data-testid={`cancel-leave-btn-${leave.id}`}
                              >
                                Cancel
                              </button>
                            )}

                            {/* Ledger Option */}
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() =>
                                setLedgerTarget({
                                  id: leave.employee_id,
                                  name: leave.employee_name || `Employee #${leave.employee_id}`,
                                })
                              }
                              title={`View balance ledger for ${leave.employee_name || `Employee #${leave.employee_id}`}`}
                              data-testid={`view-ledger-btn-${leave.id}`}
                            >
                              📜 Ledger
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {leaveData.total > PAGE_SIZE && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderTop: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  color: '#64748b',
                }}
              >
                <div>
                  Showing {leaveOffset + 1} to{' '}
                  {Math.min(leaveOffset + PAGE_SIZE, leaveData.total)} of {leaveData.total} requests
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={leaveOffset === 0 || isLeaveLoading}
                    onClick={() => setLeaveOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                    data-testid="leave-prev-page-btn"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={leaveOffset + PAGE_SIZE >= leaveData.total || isLeaveLoading}
                    onClick={() => setLeaveOffset((prev) => prev + PAGE_SIZE)}
                    data-testid="leave-next-page-btn"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUBVIEW 2: HOLIDAY CALENDAR */}
      {/* =================================================================== */}
      {activeSubTab === 'holidays' && (
        <div data-testid="holiday-calendar-section">
          {/* Filter Toolbar */}
          <section className="toolbar-card" aria-label="Holiday calendar filters" style={{ marginBottom: '20px' }}>
            <div className="toolbar-filters" style={{ flexWrap: 'wrap', gap: '10px' }}>
              {/* Office Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="holiday-office-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Office Scope
                </label>
                <select
                  id="holiday-office-filter"
                  className="filter-select"
                  value={holidayOfficeFilter}
                  onChange={(e) => setHolidayOfficeFilter(e.target.value)}
                  data-testid="holiday-office-filter"
                >
                  <option value="ALL">All Holidays (Org-wide & Offices)</option>
                  <option value="ORG_WIDE">🌐 Organization-wide Only</option>
                  {offices.map((office) => (
                    <option key={office.id} value={String(office.id)}>
                      🏢 {office.name} ({office.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Start Date */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="holiday-start-date" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  From Date
                </label>
                <input
                  id="holiday-start-date"
                  type="date"
                  className="filter-select"
                  value={holidayStartDate}
                  onChange={(e) => setHolidayStartDate(e.target.value)}
                  data-testid="holiday-start-date-filter"
                />
              </div>

              {/* End Date */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label htmlFor="holiday-end-date" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  To Date
                </label>
                <input
                  id="holiday-end-date"
                  type="date"
                  className="filter-select"
                  value={holidayEndDate}
                  onChange={(e) => setHolidayEndDate(e.target.value)}
                  data-testid="holiday-end-date-filter"
                />
              </div>

              {/* Clear Filters */}
              {(holidayOfficeFilter !== 'ALL' || holidayStartDate || holidayEndDate) && (
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-clear-filters"
                    onClick={() => {
                      setHolidayOfficeFilter('ALL');
                      setHolidayStartDate('');
                      setHolidayEndDate('');
                    }}
                    data-testid="clear-holiday-filters-btn"
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Error Banner */}
          {holidayError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '16px' }} data-testid="holiday-error-banner">
              <div className="alert-content">
                <span>⚠️</span>
                <span>{holidayError}</span>
              </div>
            </div>
          )}

          {/* Table or Loading */}
          <div className="table-container" style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
            {isHolidayLoading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }} data-testid="holiday-loading">
                <span className="spinner" aria-hidden="true" style={{ marginRight: '8px' }} />
                Loading holiday calendar...
              </div>
            ) : holidays.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }} data-testid="holiday-empty-state">
                <p style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '8px' }}>No holidays scheduled</p>
                <p style={{ fontSize: '0.85rem' }}>
                  {canManageHols
                    ? "Click '+ Add Holiday' to create an organization-wide or office-specific holiday."
                    : 'No holidays match the selected date or office filter.'}
                </p>
              </div>
            ) : (
              <table className="table" aria-label="Holiday calendar list" data-testid="holiday-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Holiday Name</th>
                    <th>Description</th>
                    <th>Scope</th>
                    <th>Category</th>
                    {canManageHols && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((hol) => (
                    <tr key={hol.id} data-testid={`holiday-row-${hol.id}`}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {hol.holiday_date}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {hol.name}
                      </td>
                      <td style={{ maxWidth: '300px', wordBreak: 'break-word', color: '#475569' }}>
                        {hol.description || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
                      </td>
                      <td>
                        {hol.office_id === null ? (
                          <span className="badge-holiday-scope badge-scope-org" data-testid={`holiday-scope-org-${hol.id}`}>
                            🌐 Org-wide
                          </span>
                        ) : (
                          <span className="badge-holiday-scope badge-scope-office" data-testid={`holiday-scope-office-${hol.id}`}>
                            🏢 {hol.office_name || `Office #${hol.office_id}`}
                          </span>
                        )}
                      </td>
                      <td>
                        {hol.is_optional ? (
                          <span className="badge-holiday-type badge-type-optional">Optional</span>
                        ) : (
                          <span className="badge-holiday-type badge-type-official">Official Holiday</span>
                        )}
                      </td>
                      {canManageHols && (
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setSelectedHoliday(hol);
                                setHolidayModalMode('edit');
                                setHolidayModalError(null);
                                setIsHolidayModalOpen(true);
                              }}
                              data-testid={`edit-holiday-btn-${hol.id}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => {
                                setDeletingHoliday(hol);
                                setDeleteHolidayError(null);
                              }}
                              data-testid={`delete-holiday-btn-${hol.id}`}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUBVIEW 3: LEAVE ENTITLEMENTS (ADMIN ONLY)                          */}
      {/* =================================================================== */}
      {activeSubTab === 'entitlements' && isAdmin && (
        <div data-testid="leave-entitlements-section">
          {/* Year Toolbar */}
          <section className="toolbar-card" style={{ marginBottom: '20px' }}>
            <div className="toolbar-filters" style={{ alignItems: 'center', justifyContent: 'space-between', width: '100%', display: 'flex' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label htmlFor="entitlement-year-select" style={{ fontWeight: 600, color: '#475569' }}>
                  Calendar Leave Year:
                </label>
                <select
                  id="entitlement-year-select"
                  className="filter-select"
                  value={entitlementYear}
                  onChange={(e) => setEntitlementYear(parseInt(e.target.value, 10))}
                  data-testid="entitlement-year-select"
                >
                  <option value={CURRENT_YEAR - 1}>{CURRENT_YEAR - 1}</option>
                  <option value={CURRENT_YEAR}>{CURRENT_YEAR} (Current)</option>
                  <option value={CURRENT_YEAR + 1}>{CURRENT_YEAR + 1}</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEntitlementModalMode('override');
                    setEditingOverride(null);
                    setEditingDefault(null);
                    setIsEntitlementModalOpen(true);
                  }}
                  data-testid="add-override-btn"
                >
                  ➕ Add Employee Override
                </button>
              </div>
            </div>
          </section>

          {isEntitlementsLoading && (
            <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
              Loading entitlement configuration...
            </div>
          )}

          {entitlementsError && (
            <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>
              {entitlementsError}
            </div>
          )}

          {!isEntitlementsLoading && (
            <>
              {/* Card 1: Org Defaults */}
              <section className="dashboard-card" style={{ marginBottom: '24px' }}>
                <div className="dashboard-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>🏢 Organization Annual Defaults ({entitlementYear})</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                      Baseline annual leave working days applied to all employees without individual overrides.
                    </p>
                  </div>
                </div>

                <div className="table-responsive" style={{ marginTop: '16px' }}>
                  <table className="data-table" data-testid="org-defaults-table">
                    <thead>
                      <tr>
                        <th>Leave Category</th>
                        <th>Allocated Days (Annual)</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['ANNUAL', 'SICK', 'CASUAL'] as const).map((cat) => {
                        const def = entitlementDefaults.find((d) => d.leave_type === cat);
                        return (
                          <tr key={cat}>
                            <td style={{ fontWeight: 600 }}>
                              {cat === 'ANNUAL' ? '🏖️ Annual Leave (ANNUAL)' : cat === 'SICK' ? '🤒 Sick Leave (SICK)' : '🌴 Casual Leave (CASUAL)'}
                            </td>
                            <td>
                              {def ? (
                                <strong style={{ fontSize: '1.05rem', color: '#1e293b' }}>{def.allocated_days} days</strong>
                              ) : (
                                <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Not configured (unconstrained)</span>
                              )}
                            </td>
                            <td>
                              {def ? (
                                <span className="status-pill status-pill-active">Enforced</span>
                              ) : (
                                <span className="status-pill status-pill-offline">Inactive</span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ marginRight: '8px' }}
                                onClick={() => {
                                  setEntitlementModalMode('default');
                                  setEditingDefault(
                                    def || {
                                      id: 0,
                                      year: entitlementYear,
                                      leave_type: cat,
                                      allocated_days: 15,
                                      created_at: '',
                                      updated_at: '',
                                    }
                                  );
                                  setEditingOverride(null);
                                  setIsEntitlementModalOpen(true);
                                }}
                                data-testid={`configure-default-${cat.toLowerCase()}`}
                              >
                                ⚙️ {def ? 'Edit Quota' : 'Configure Quota'}
                              </button>
                              {def && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleDeleteDefault(def.id)}
                                  data-testid={`delete-default-${cat.toLowerCase()}`}
                                >
                                  🗑️ Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Card 2: Employee Overrides */}
              <section className="dashboard-card">
                <div className="dashboard-card-header">
                  <h3 style={{ margin: 0 }}>👤 Individual Employee Overrides ({entitlementYear})</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                    Overrides replace organization defaults for a specific employee in calendar year {entitlementYear}.
                  </p>
                </div>

                <div className="table-responsive" style={{ marginTop: '16px' }}>
                  {entitlementOverrides.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                      No employee overrides configured for {entitlementYear}. All employees use organization defaults.
                    </div>
                  ) : (
                    <table className="data-table" data-testid="employee-overrides-table">
                      <thead>
                        <tr>
                          <th>Employee Code</th>
                          <th>Employee Name</th>
                          <th>Department</th>
                          <th>Leave Type</th>
                          <th>Override Allocated Days</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entitlementOverrides.map((ov) => (
                          <tr key={ov.id}>
                            <td>
                              <span className="code-badge">{ov.employee_code || `EMP-${ov.employee_id}`}</span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{ov.employee_name || '—'}</td>
                            <td>{ov.department || '—'}</td>
                            <td>
                              <span className="status-pill status-pill-active">{ov.leave_type}</span>
                            </td>
                            <td>
                              <strong style={{ fontSize: '1rem', color: '#1e293b' }}>{ov.allocated_days} days</strong>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ marginRight: '8px' }}
                                onClick={() => {
                                  setEntitlementModalMode('override');
                                  setEditingOverride(ov);
                                  setEditingDefault(null);
                                  setIsEntitlementModalOpen(true);
                                }}
                                data-testid={`edit-override-${ov.id}`}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handleDeleteOverride(ov.id)}
                                data-testid={`delete-override-${ov.id}`}
                              >
                                🗑️ Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* MODALS */}
      {/* =================================================================== */}

      {/* Leave Request Create Modal */}
      <LeaveModal
        isOpen={isLeaveModalOpen}
        currentUser={currentUser}
        isSubmitting={isLeaveSubmitting}
        serverError={leaveModalError}
        onClose={() => setIsLeaveModalOpen(false)}
        onSubmit={handleCreateLeaveSubmit}
      />

      {/* Review Modal (Approve / Reject) */}
      {reviewingRequest && (
        <div
          className="modal-backdrop"
          onClick={() => !isReviewSubmitting && setReviewingRequest(null)}
          data-testid="review-modal-backdrop"
        >
          <div
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '480px' }}
          >
            <div className="modal-header">
              <h2 id="review-modal-title" className="modal-title">
                {reviewAction === 'APPROVED' ? 'Approve Leave Request' : 'Reject Leave Request'}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setReviewingRequest(null)}
                aria-label="Close modal"
                disabled={isReviewSubmitting}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleReviewSubmit}>
              <div className="modal-body">
                {reviewError && (
                  <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>
                    {reviewError}
                  </div>
                )}

                <p style={{ marginBottom: '16px', fontSize: '0.95rem' }}>
                  Are you sure you want to <strong>{reviewAction.toLowerCase()}</strong> the leave request for{' '}
                  <strong>{reviewingRequest.employee_name || `Employee #${reviewingRequest.employee_id}`}</strong>
                  {reviewingRequest.department ? ` (${reviewingRequest.department})` : ''}?
                </p>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '0.85rem',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <strong>Dates:</strong> {reviewingRequest.start_date} → {reviewingRequest.end_date} (
                    {formatWorkingDays(reviewingRequest.working_days)})
                  </div>
                  <div>
                    <strong>Type:</strong> {reviewingRequest.leave_type}
                  </div>
                  {reviewingRequest.reason && (
                    <div style={{ marginTop: '4px' }}>
                      <strong>Reason:</strong> {reviewingRequest.reason}
                    </div>
                  )}
                </div>

                {reviewingRequest.allocated_days !== undefined && reviewingRequest.allocated_days !== null && (
                  <div
                    style={{
                      background: '#f0fdf4',
                      padding: '12px',
                      borderRadius: '6px',
                      marginBottom: '16px',
                      fontSize: '0.85rem',
                      border: '1px solid #bbf7d0',
                    }}
                    data-testid="review-balance-impact"
                  >
                    <div style={{ fontWeight: 600, color: '#166534', marginBottom: '8px' }}>
                      📊 Balance Impact ({reviewingRequest.leave_type})
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center' }}>
                      <div style={{ background: '#ffffff', padding: '6px', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>Annual Quota</span>
                        <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>{reviewingRequest.allocated_days}d</strong>
                      </div>
                      <div style={{ background: '#ffffff', padding: '6px', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>Available Before</span>
                        <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>
                          {reviewingRequest.available_days_before ?? '—'}d
                        </strong>
                      </div>
                      <div style={{ background: '#ffffff', padding: '6px', borderRadius: '4px', border: '1px solid #dcfce7' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>Available After</span>
                        <strong
                          style={{
                            fontSize: '0.95rem',
                            color: (reviewingRequest.available_days_after ?? 0) < 0 ? '#dc2626' : '#16a34a',
                          }}
                        >
                          {reviewingRequest.available_days_after ?? '—'}d
                        </strong>
                      </div>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="review-decision-notes" className="form-label">
                    Decision Notes (Optional)
                  </label>
                  <textarea
                    id="review-decision-notes"
                    rows={3}
                    placeholder="Enter optional notes explaining this decision..."
                    className="form-textarea"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    disabled={isReviewSubmitting}
                    data-testid="review-decision-notes-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReviewingRequest(null)}
                  disabled={isReviewSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn ${reviewAction === 'APPROVED' ? 'btn-success' : 'btn-danger'}`}
                  disabled={isReviewSubmitting}
                  data-testid="confirm-review-btn"
                >
                  {isReviewSubmitting
                    ? 'Submitting...'
                    : reviewAction === 'APPROVED'
                    ? 'Confirm Approval'
                    : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Request Modal */}
      {cancellingRequest && (
        <div
          className="modal-backdrop"
          onClick={() => !isCancelSubmitting && setCancellingRequest(null)}
          data-testid="cancel-modal-backdrop"
        >
          <div
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '460px' }}
          >
            <div className="modal-header">
              <h2 id="cancel-modal-title" className="modal-title">
                Cancel Leave Request
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setCancellingRequest(null)}
                aria-label="Close modal"
                disabled={isCancelSubmitting}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCancelSubmit}>
              <div className="modal-body">
                {cancelError && (
                  <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>
                    {cancelError}
                  </div>
                )}

                <p style={{ marginBottom: '16px', fontSize: '0.95rem' }}>
                  Are you sure you want to cancel this leave request? This action cannot be undone.
                </p>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '0.85rem',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <strong>Dates:</strong> {cancellingRequest.start_date} → {cancellingRequest.end_date}
                  </div>
                  <div>
                    <strong>Type:</strong> {cancellingRequest.leave_type}
                  </div>
                  <div>
                    <strong>Current Status:</strong> {cancellingRequest.status}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="cancellation-reason" className="form-label">
                    Cancellation Reason (Optional)
                  </label>
                  <textarea
                    id="cancellation-reason"
                    rows={2}
                    placeholder="Enter reason for cancelling this request..."
                    className="form-textarea"
                    value={cancelNotes}
                    onChange={(e) => setCancelNotes(e.target.value)}
                    disabled={isCancelSubmitting}
                    data-testid="cancel-reason-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCancellingRequest(null)}
                  disabled={isCancelSubmitting}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={isCancelSubmitting}
                  data-testid="confirm-cancel-btn"
                >
                  {isCancelSubmitting ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Holiday Create / Edit Modal */}
      <HolidayModal
        isOpen={isHolidayModalOpen}
        mode={holidayModalMode}
        offices={offices}
        initialData={selectedHoliday}
        isSubmitting={isHolidaySubmitting}
        serverError={holidayModalError}
        onClose={() => setIsHolidayModalOpen(false)}
        onSubmit={handleHolidayModalSubmit}
      />

      {/* Delete Holiday Confirmation Modal */}
      {deletingHoliday && (
        <div
          className="modal-backdrop"
          onClick={() => !isDeletingHoliday && setDeletingHoliday(null)}
          data-testid="delete-holiday-modal-backdrop"
        >
          <div
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-holiday-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="modal-header">
              <h2 id="delete-holiday-title" className="modal-title">
                Delete Holiday
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDeletingHoliday(null)}
                aria-label="Close modal"
                disabled={isDeletingHoliday}
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              {deleteHolidayError && (
                <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>
                  {deleteHolidayError}
                </div>
              )}

              <p style={{ marginBottom: '12px' }}>
                Are you sure you want to delete the holiday <strong>{deletingHoliday.name}</strong> on{' '}
                <strong>{deletingHoliday.holiday_date}</strong>?
              </p>
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                This record will be permanently deleted and an audit entry will be logged.
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeletingHoliday(null)}
                disabled={isDeletingHoliday}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmDeleteHoliday}
                disabled={isDeletingHoliday}
                data-testid="confirm-delete-holiday-btn"
              >
                {isDeletingHoliday ? 'Deleting...' : 'Delete Holiday'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Leave Entitlement Configuration Modal */}
      <LeaveEntitlementModal
        isOpen={isEntitlementModalOpen}
        mode={entitlementModalMode}
        year={entitlementYear}
        initialDefault={editingDefault}
        initialOverride={editingOverride}
        employees={employeesList}
        onClose={() => setIsEntitlementModalOpen(false)}
        onSaveDefault={handleSaveDefault}
        onSaveOverride={handleSaveOverride}
      />

      {/* Leave Balance History / Ledger Modal */}
      <LeaveBalanceLedgerModal
        isOpen={ledgerTarget !== null}
        employeeId={ledgerTarget?.id ?? null}
        employeeName={ledgerTarget?.name}
        year={CURRENT_YEAR}
        onClose={() => setLedgerTarget(null)}
      />
    </main>
  );
};
