import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAttendanceRecords,
  getDailyAttendanceOperations,
  recordAttendancePunch,
} from '../api/attendanceApi';
import { getEmployeeLeaveBalances, getLeaveRequests } from '../api/leaveApi';
import { ApiError } from '../api/apiError';
import type { User } from '../types/auth';
import type {
  AttendanceEventDetail,
  AttendancePunchCreatePayload,
  DailyPunchDetail,
  EmployeeDailyAttendanceItem,
} from '../types/attendance';
import type {
  EmployeeLeaveBalanceSummary,
  LeaveRequestDetail,
  LeaveType,
} from '../types/leave';
import { PunchModal } from './PunchModal';
import { LeaveBalanceLedgerModal } from './LeaveBalanceLedgerModal';
import './components.css';

export interface EmployeeDashboardViewProps {
  currentUser: User;
  sessionEpoch: number;
  onNavigateToAttendance?: () => void;
  onNavigateToLeaves?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToDirectory?: () => void;
}

const CURRENT_YEAR = new Date().getFullYear();
const TODAY_FORMATTED_DATE = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export const EmployeeDashboardView: React.FC<EmployeeDashboardViewProps> = ({
  currentUser,
  sessionEpoch,
  onNavigateToAttendance,
  onNavigateToLeaves,
  onNavigateToProfile,
  onNavigateToDirectory,
}) => {
  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  // Loading and Error states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  // Attendance Data
  const [dailyRecord, setDailyRecord] = useState<EmployeeDailyAttendanceItem | null>(null);
  const [recentEvents, setRecentEvents] = useState<AttendanceEventDetail[]>([]);

  // Leaves Data
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestDetail[]>([]);
  const [balancesSummary, setBalancesSummary] = useState<EmployeeLeaveBalanceSummary | null>(null);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState<boolean>(false);

  // Punch modal state
  const [isPunchModalOpen, setIsPunchModalOpen] = useState<boolean>(false);
  const [isPunchSubmitting, setIsPunchSubmitting] = useState<boolean>(false);
  const [punchServerError, setPunchServerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-dismiss feedback
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Format helpers
  const formatTimeOnly = (isoStr: string | null | undefined): string => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  const formatTimestamp = (isoStr: string | null | undefined): string => {
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

  // Fetch all dashboard data concurrently with sessionEpoch protection
  useEffect(() => {
    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    Promise.all([
      getDailyAttendanceOperations(),
      getAttendanceRecords({ limit: 5 }),
      getLeaveRequests({ limit: 50 }),
    ])
      .then(([dailyRes, eventsRes, leavesRes]) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;

        if (dailyRes.employees && dailyRes.employees.length > 0) {
          setDailyRecord(dailyRes.employees[0]);
        } else {
          setDailyRecord(null);
        }

        setRecentEvents(eventsRes.items || []);
        setLeaveRequests(leavesRes.items || []);

        if (currentUser.employee_id && typeof getEmployeeLeaveBalances === 'function') {
          getEmployeeLeaveBalances(currentUser.employee_id)
            .then((balRes) => {
              if (isMounted) setBalancesSummary(balRes);
            })
            .catch(() => {
              // Non-critical fallback to computed usage
            });
        }

        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Failed to load dashboard data. Please try again.';
        setLoadError(message);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reloadTrigger, currentUser.employee_id]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    setReloadTrigger((prev) => prev + 1);
  }, []);

  // Compute punch state from today's punches
  const punchState = useMemo(() => {
    const punches: DailyPunchDetail[] = dailyRecord?.punches || [];
    if (punches.length === 0) {
      return {
        status: 'NOT_CHECKED_IN' as const,
        label: 'Not Checked In',
        badgeClass: 'status-pill-offline',
        recommendedPunch: 'CHECK_IN' as const,
        actionLabel: 'Check In',
        actionClass: 'btn-punch-in',
        lastPunchTime: null,
      };
    }

    const lastPunch = punches[punches.length - 1];
    if (lastPunch.punch_type === 'CHECK_IN') {
      return {
        status: 'CHECKED_IN' as const,
        label: 'Checked In',
        badgeClass: 'status-pill-active',
        recommendedPunch: 'CHECK_OUT' as const,
        actionLabel: 'Check Out',
        actionClass: 'btn-punch-out',
        lastPunchTime: lastPunch.event_timestamp,
      };
    }

    return {
      status: 'CHECKED_OUT' as const,
      label: 'Checked Out',
      badgeClass: 'status-pill-decommissioned',
      recommendedPunch: 'CHECK_IN' as const,
      actionLabel: 'Check In',
      actionClass: 'btn-punch-in',
      lastPunchTime: lastPunch.event_timestamp,
    };
  }, [dailyRecord]);

  // Compute leave balances & summaries
  const leaveSummary = useMemo(() => {
    const currentYear = CURRENT_YEAR;

    const usedDays: Record<string, number> = {
      ANNUAL: 0,
      SICK: 0,
      CASUAL: 0,
      UNPAID: 0,
    };

    const pendingDays: Record<string, number> = {
      ANNUAL: 0,
      SICK: 0,
      CASUAL: 0,
      UNPAID: 0,
    };

    const pendingList: LeaveRequestDetail[] = [];

    for (const req of leaveRequests) {
      const type = (req.leave_type || '').toUpperCase();

      if (req.status === 'PENDING') {
        pendingList.push(req);
      }

      // Exclude unknown legacy durations from working-day usage totals
      if (req.working_days === null || req.working_days === undefined) {
        continue;
      }

      const duration = req.working_days;

      if (req.status === 'PENDING') {
        if (type in pendingDays) {
          pendingDays[type] += duration;
        }
      } else if (req.status === 'APPROVED') {
        // Count if in current year
        const startYear = new Date(req.start_date + 'T00:00:00Z').getFullYear();
        if (startYear === currentYear) {
          if (type in usedDays) {
            usedDays[type] += duration;
          }
        }
      }
    }

    const usageItems = (['ANNUAL', 'SICK', 'CASUAL'] as LeaveType[]).map((type) => {
      const liveBal = balancesSummary?.balances?.find((b) => b.leave_type === type);
      const used = liveBal ? liveBal.used_days : (usedDays[type] || 0);
      const pending = liveBal ? liveBal.pending_days : (pendingDays[type] || 0);
      const allocated = liveBal?.allocated_days ?? null;
      const available = liveBal?.available_days ?? null;
      const isEnforced = liveBal?.is_enforced ?? false;
      const isOverride = liveBal?.is_override ?? false;

      return {
        type,
        label: type === 'ANNUAL' ? 'Annual Leave' : type === 'SICK' ? 'Sick Leave' : 'Casual Leave',
        icon: type === 'ANNUAL' ? '🏖️' : type === 'SICK' ? '🤒' : '🌴',
        used,
        pending,
        allocated,
        available,
        isEnforced,
        isOverride,
      };
    });

    return {
      usageItems,
      pendingRequests: pendingList,
      totalPendingCount: pendingList.length,
      totalApprovedDays:
        usedDays.ANNUAL + usedDays.SICK + usedDays.CASUAL + usedDays.UNPAID,
    };
  }, [leaveRequests, balancesSummary]);

  // Handle punch submission from PunchModal
  const handlePunchSubmit = async (payload: AttendancePunchCreatePayload) => {
    if (isPunchSubmitting) return;
    setIsPunchSubmitting(true);
    setPunchServerError(null);

    try {
      const response = await recordAttendancePunch(payload);
      setIsPunchModalOpen(false);
      const actionLabel = response.punch_type === 'CHECK_IN' ? 'Check In' : 'Check Out';
      const timeStr = formatTimeOnly(response.event_timestamp);
      setFeedback({
        type: 'success',
        message: `${actionLabel} successfully recorded at ${timeStr}${
          response.is_roaming ? ' (Roaming punch flagged under GOV-08)' : ''
        }.`,
      });
      // Refresh dashboard data
      handleRefresh();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setPunchServerError(err.message);
      } else if (err instanceof Error) {
        setPunchServerError(err.message);
      } else {
        setPunchServerError('An unexpected error occurred while recording the attendance punch.');
      }
    } finally {
      setIsPunchSubmitting(false);
    }
  };

  return (
    <main className="dashboard-wrapper employee-dashboard" aria-label="Employee Dashboard">
      {/* Employee Navigation Subnav */}
      <div className="employee-subnav" role="tablist" aria-label="Employee navigation">
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="nav-tab-btn active"
          aria-current="page"
        >
          📊 Dashboard
        </button>
        {onNavigateToAttendance && (
          <button
            type="button"
            role="tab"
            aria-selected="false"
            className="nav-tab-btn"
            onClick={onNavigateToAttendance}
          >
            ⏱️ Attendance
          </button>
        )}
        {onNavigateToLeaves && (
          <button
            type="button"
            role="tab"
            aria-selected="false"
            className="nav-tab-btn"
            onClick={onNavigateToLeaves}
          >
            🏖️ Leaves & Holidays
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
            👤 My Profile
          </button>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`alert-banner ${feedback.type === 'success' ? 'success' : 'error'}`}
          role="status"
          aria-live="polite"
        >
          <div className="alert-content">
            <span aria-hidden="true">{feedback.type === 'success' ? '✓' : '⚠️'}</span>
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

      {/* Loading State */}
      {isLoading ? (
        <div className="dashboard-loading-state" role="progressbar" aria-label="Loading dashboard data...">
          <div className="loading-spinner" aria-hidden="true" />
          <p>Loading your dashboard...</p>
        </div>
      ) : loadError ? (
        /* Error State with Retry Button */
        <div className="alert-banner error" role="alert" style={{ marginTop: '1.5rem' }}>
          <div className="alert-content">
            <span aria-hidden="true">⚠️</span>
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: '1rem' }}
            onClick={handleRefresh}
          >
            Retry
          </button>
        </div>
      ) : (
        /* Main Dashboard Content */
        <div className="employee-dashboard-content">
          {/* Welcome Banner */}
          <section className="dashboard-welcome-banner" aria-label="Welcome banner">
            <div className="welcome-avatar-circle" aria-hidden="true">
              {currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'E'}
            </div>
            <div className="welcome-text-block">
              <h2>Welcome back, {currentUser.full_name}!</h2>
              <p className="welcome-subtitle">{TODAY_FORMATTED_DATE}</p>
            </div>
            <div className="welcome-quick-actions">
              {onNavigateToAttendance && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onNavigateToAttendance}
                >
                  ⏱️ My Attendance
                </button>
              )}
              {onNavigateToLeaves && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onNavigateToLeaves}
                >
                  🏖️ Leaves & Holidays
                </button>
              )}
              {onNavigateToProfile && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onNavigateToProfile}
                >
                  👤 View Profile
                </button>
              )}
              {onNavigateToDirectory && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onNavigateToDirectory}
                >
                  👥 Employee Directory
                </button>
              )}
            </div>
          </section>

          {/* Top Row: Attendance Status & Leave Balances */}
          <div className="dashboard-grid top-grid">
            {/* Card 1: Today's Attendance Status */}
            <div
              className="dashboard-card attendance-status-card"
              data-testid="dashboard-today-attendance"
            >
              <div className="dashboard-card-header">
                <h3>Today's Attendance</h3>
                <span className={`status-pill ${punchState.badgeClass}`}>
                  <span className="mbiotrack-status-dot" aria-hidden="true" />
                  {punchState.label}
                </span>
              </div>

              <div className="punch-timings-grid">
                <div className="punch-timing-box">
                  <span className="timing-label">First Check-In</span>
                  <span className="timing-value font-mono">
                    {formatTimeOnly(dailyRecord?.first_punch)}
                  </span>
                </div>
                <div className="punch-timing-box">
                  <span className="timing-label">Last Check-Out</span>
                  <span className="timing-value font-mono">
                    {formatTimeOnly(dailyRecord?.last_punch)}
                  </span>
                </div>
                <div className="punch-timing-box">
                  <span className="timing-label">Total Punches</span>
                  <span className="timing-value">{dailyRecord?.punch_count ?? 0}</span>
                </div>
              </div>

              <div className="dashboard-card-action">
                <button
                  type="button"
                  className={`btn ${punchState.actionClass}`}
                  onClick={() => setIsPunchModalOpen(true)}
                  data-testid="dashboard-punch-btn"
                >
                  {punchState.recommendedPunch === 'CHECK_IN' ? '🟢 Check In' : '🔴 Check Out'}
                </button>
                {onNavigateToAttendance && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onNavigateToAttendance}
                  >
                    View Attendance Details →
                  </button>
                )}
              </div>
            </div>

            {/* Card 2: Leave Usage Summary */}
            <div
              className="dashboard-card leave-balance-card"
              data-testid="dashboard-leave-balance"
            >
              <div className="dashboard-card-header">
                <h3>Leave Usage Summary</h3>
              </div>

              <div className="leave-balance-grid">
                {leaveSummary.usageItems.map((item) => (
                  <div key={item.type} className="leave-balance-item">
                    <div className="leave-icon" aria-hidden="true">
                      {item.icon}
                    </div>
                    <div className="leave-details">
                      <span className="leave-title">
                        {item.label}
                        {item.isOverride && (
                          <span
                            style={{
                              marginLeft: '6px',
                              fontSize: '0.65rem',
                              background: '#e0e7ff',
                              color: '#4338ca',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 600,
                            }}
                          >
                            Override
                          </span>
                        )}
                      </span>
                      <div className="leave-available">
                        {item.isEnforced && item.available !== null ? (
                          <>
                            <strong>{item.available}</strong>
                            <span className="leave-total"> of {item.allocated}d available</span>
                          </>
                        ) : (
                          <>
                            <strong>{item.used}</strong>
                            <span className="leave-total"> {item.used === 1 ? 'day approved' : 'days approved'}</span>
                          </>
                        )}
                      </div>
                      <div className="leave-stats-row">
                        {item.isEnforced ? (
                          <span>
                            {item.used}d used · {item.pending}d pending
                          </span>
                        ) : item.pending > 0 ? (
                          <span className="leave-pending-stat">Pending: {item.pending}d</span>
                        ) : (
                          <span className="text-muted">0d pending</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="dashboard-card-action" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {currentUser.employee_id && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsLedgerModalOpen(true)}
                    data-testid="view-balance-history-btn"
                  >
                    📜 Balance History
                  </button>
                )}
                {onNavigateToLeaves && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onNavigateToLeaves}
                  >
                    🏖️ Apply for Leave
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Recent Attendance & Pending Leaves */}
          <div className="dashboard-grid bottom-grid">
            {/* Card 3: Recent Attendance History */}
            <div
              className="dashboard-card recent-attendance-card"
              data-testid="dashboard-recent-punches"
            >
              <div className="dashboard-card-header">
                <h3>Recent Attendance History</h3>
                {onNavigateToAttendance && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={onNavigateToAttendance}
                  >
                    View All →
                  </button>
                )}
              </div>

              {recentEvents.length === 0 ? (
                <div className="empty-state-card" data-testid="empty-recent-punches">
                  <p className="empty-title">No recent punches</p>
                  <p className="empty-subtitle">
                    Punches recorded at physical biometric terminals will appear here.
                  </p>
                </div>
              ) : (
                <div className="recent-list-table-wrapper">
                  <table className="recent-table" aria-label="Recent attendance records">
                    <thead>
                      <tr>
                        <th scope="col">Date & Time</th>
                        <th scope="col">Type</th>
                        <th scope="col">Location / Device</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td className="font-mono">{formatTimestamp(ev.event_timestamp)}</td>
                          <td>
                            <span
                              className={`audit-badge ${
                                ev.punch_type === 'CHECK_IN' ? 'badge-create' : 'badge-update'
                              }`}
                            >
                              {ev.punch_type === 'CHECK_IN' ? 'CHECK IN' : 'CHECK OUT'}
                            </span>
                          </td>
                          <td>
                            <div>{ev.office_name || 'Main Office'}</div>
                            <small className="text-muted">{ev.device_name || 'Terminal'}</small>
                            {ev.is_roaming && (
                              <span className="roaming-badge" style={{ marginLeft: '0.4rem' }}>
                                Roaming
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Card 4: Pending Leave Requests */}
            <div
              className="dashboard-card pending-leaves-card"
              data-testid="dashboard-pending-leaves"
            >
              <div className="dashboard-card-header">
                <h3>Pending Leave Requests</h3>
                <span className="badge-pending">
                  {leaveSummary.totalPendingCount} Pending
                </span>
              </div>

              {leaveSummary.pendingRequests.length === 0 ? (
                <div className="empty-state-card" data-testid="empty-pending-leaves">
                  <p className="empty-title">No pending leave requests</p>
                  <p className="empty-subtitle">
                    All your leave requests have been processed.
                  </p>
                  {onNavigateToLeaves && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '0.75rem' }}
                      onClick={onNavigateToLeaves}
                    >
                      Apply for Leave
                    </button>
                  )}
                </div>
              ) : (
                <div className="recent-list-table-wrapper">
                  <table className="recent-table" aria-label="Pending leave requests">
                    <thead>
                      <tr>
                        <th scope="col">Period</th>
                        <th scope="col">Type</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveSummary.pendingRequests.map((req) => (
                        <tr key={req.id}>
                          <td>
                            <div className="font-mono">
                              {req.start_date} to {req.end_date}
                            </div>
                            <small className="text-muted">
                              {req.working_days !== null && req.working_days !== undefined
                                ? (req.working_days === 1
                                    ? '1 working day'
                                    : `${req.working_days} working days`)
                                : 'Legacy — duration unavailable'}
                            </small>
                          </td>
                          <td>
                            <span className="audit-badge badge-create">
                              {req.leave_type}
                            </span>
                          </td>
                          <td className="leave-reason-cell">
                            {req.reason || <span className="text-muted">—</span>}
                          </td>
                          <td>
                            <span className="badge-pending">PENDING</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reusable Punch Confirmation Modal */}
      <PunchModal
        isOpen={isPunchModalOpen}
        currentUser={currentUser}
        defaultPunchType={punchState.recommendedPunch}
        isSubmitting={isPunchSubmitting}
        serverError={punchServerError}
        onClose={() => {
          setPunchServerError(null);
          setIsPunchModalOpen(false);
        }}
        onSubmit={handlePunchSubmit}
      />

      {/* Leave Balance History Modal */}
      <LeaveBalanceLedgerModal
        isOpen={isLedgerModalOpen}
        employeeId={currentUser.employee_id ?? null}
        employeeName={currentUser.full_name}
        year={CURRENT_YEAR}
        onClose={() => setIsLedgerModalOpen(false)}
      />
    </main>
  );
};
