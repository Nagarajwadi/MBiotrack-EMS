import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledgeAttendanceException,
  getAttendanceReviews,
  getTeamAttendanceSummary,
} from '../api/attendanceApi';
import { ApiError } from '../api/apiError';
import type { User } from '../types/auth';
import type {
  AttendanceReviewResponse,
  DailyAttendanceOperationsResponse,
  DailyPunchDetail,
  EmployeeDailyAttendanceItem,
} from '../types/attendance';
import { canViewTeamAttendance } from '../utils/permissions';
import './components.css';

export interface ManagerTeamAttendanceViewProps {
  currentUser: User;
  sessionEpoch: number;
  onNavigateToDirectory?: () => void;
  onNavigateToAttendance?: () => void;
  onNavigateToLeaves?: () => void;
}

type StatusFilter =
  | 'ALL'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'NOT_CHECKED_IN'
  | 'REQUIRES_REVIEW'
  | 'ACKNOWLEDGED';

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(isoStr: string | null | undefined): string {
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
}

function formatDateTime(isoStr: string | null | undefined): string {
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
      second: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function deriveEmployeeAttendanceStatus(
  item: EmployeeDailyAttendanceItem
): {
  key: 'CHECKED_IN' | 'CHECKED_OUT' | 'NOT_CHECKED_IN';
  label: string;
  pillClass: string;
} {
  if (!item.punches || item.punches.length === 0) {
    return {
      key: 'NOT_CHECKED_IN',
      label: 'Not Checked In',
      pillClass: 'team-pill-not-in',
    };
  }

  const latestPunch = item.punches[item.punches.length - 1];
  if (latestPunch.punch_type === 'CHECK_IN') {
    return {
      key: 'CHECKED_IN',
      label: 'Checked In',
      pillClass: 'team-pill-checked-in',
    };
  }

  return {
    key: 'CHECKED_OUT',
    label: 'Checked Out',
    pillClass: 'team-pill-checked-out',
  };
}

export const ManagerTeamAttendanceView: React.FC<ManagerTeamAttendanceViewProps> = ({
  currentUser,
  sessionEpoch,
  onNavigateToDirectory,
  onNavigateToAttendance,
  onNavigateToLeaves,
}) => {
  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  const [selectedDate, setSelectedDate] = useState<string>(getTodayString);
  const [teamData, setTeamData] = useState<DailyAttendanceOperationsResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Employee detail drilldown modal state
  const [selectedEmployeeForDetail, setSelectedEmployeeForDetail] =
    useState<EmployeeDailyAttendanceItem | null>(null);

  // Exception Review & Acknowledgement Modal State
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);
  const [reviewSubmitError, setReviewSubmitError] = useState<string | null>(null);
  const [reviewSubmitSuccess, setReviewSubmitSuccess] = useState<string | null>(null);
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState<string>(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Review history in modal
  const [showReviewHistory, setShowReviewHistory] = useState<boolean>(false);
  const [reviewHistory, setReviewHistory] = useState<AttendanceReviewResponse[] | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Open modal and initialize fresh idempotency key & reset state
  const openEmployeeDetail = useCallback((emp: EmployeeDailyAttendanceItem) => {
    setSelectedEmployeeForDetail(emp);
    setReviewNotes('');
    setReviewSubmitError(null);
    setReviewSubmitSuccess(null);
    setShowReviewHistory(false);
    setReviewHistory(null);
    setHistoryError(null);
    setCurrentIdempotencyKey(
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
  }, []);

  const closeEmployeeDetail = useCallback(() => {
    setSelectedEmployeeForDetail(null);
    setReviewNotes('');
    setReviewSubmitError(null);
    setReviewSubmitSuccess(null);
    setShowReviewHistory(false);
    setReviewHistory(null);
    setHistoryError(null);
  }, []);

  // Submit acknowledgement handler
  const handleAcknowledgeException = useCallback(async () => {
    if (!selectedEmployeeForDetail) return;
    setIsSubmittingReview(true);
    setReviewSubmitError(null);
    setReviewSubmitSuccess(null);

    const targetDate = teamData?.summary.date || selectedDate;

    try {
      const result = await acknowledgeAttendanceException({
        employee_id: selectedEmployeeForDetail.employee_id,
        attendance_date: targetDate,
        review_status: 'ACKNOWLEDGED',
        review_notes: reviewNotes.trim() ? reviewNotes.trim() : null,
        idempotency_key: currentIdempotencyKey,
      });

      setReviewSubmitSuccess('Attendance exception successfully acknowledged.');
      setIsSubmittingReview(false);

      // Trigger background reload of team data
      setReloadTrigger((prev) => prev + 1);

      // Update selected employee in place immediately
      setSelectedEmployeeForDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          review_status: 'ACKNOWLEDGED',
          review_reason: `Roaming punches recorded (${prev.roaming_count}) - Acknowledged by ${result.reviewer_name}`,
          latest_review: result,
        };
      });
    } catch (err: unknown) {
      setIsSubmittingReview(false);
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Failed to acknowledge attendance exception. Please retry.';
      setReviewSubmitError(msg);
      // Key is preserved across retries for idempotency protection!
    }
  }, [selectedEmployeeForDetail, selectedDate, teamData, reviewNotes, currentIdempotencyKey]);

  // Load review history handler
  const handleToggleReviewHistory = useCallback(async () => {
    if (!selectedEmployeeForDetail) return;
    if (showReviewHistory) {
      setShowReviewHistory(false);
      return;
    }

    setShowReviewHistory(true);
    setIsLoadingHistory(true);
    setHistoryError(null);

    const targetDate = teamData?.summary.date || selectedDate;

    try {
      const res = await getAttendanceReviews({
        employee_id: selectedEmployeeForDetail.employee_id,
        attendance_date: targetDate,
        limit: 20,
      });
      setReviewHistory(res.items);
      setIsLoadingHistory(false);
    } catch (err: unknown) {
      setIsLoadingHistory(false);
      const msg =
        err instanceof ApiError ? err.message : 'Failed to load review history.';
      setHistoryError(msg);
    }
  }, [selectedEmployeeForDetail, selectedDate, teamData, showReviewHistory]);

  // Check role authorization
  const hasAccess = canViewTeamAttendance(currentUser.role);
  const isUnlinkedManager = currentUser.role === 'MANAGER' && !currentUser.employee_id;

  const [isLoading, setIsLoading] = useState<boolean>(() => hasAccess && !isUnlinkedManager);

  useEffect(() => {
    if (!hasAccess || isUnlinkedManager) return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    getTeamAttendanceSummary({
      date: selectedDate,
      limit: 100,
      offset: 0,
    })
      .then((response) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setTeamData(response);
        setLastRefreshedAt(new Date());

        // If detail modal is open, refresh that employee's punches in place
        setSelectedEmployeeForDetail((prev) => {
          if (!prev) return null;
          return (
            response.employees.find((e) => e.employee_id === prev.employee_id) || null
          );
        });
        setIsLoading(false);
        setIsRefreshing(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const message =
          err instanceof ApiError
            ? err.message
            : 'Failed to load team attendance records. Please try again.';
        setLoadError(message);
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [hasAccess, isUnlinkedManager, selectedDate, reloadTrigger]);

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    setLoadError(null);
    setReloadTrigger((prev) => prev + 1);
  }, []);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    setReloadTrigger((prev) => prev + 1);
  }, []);

  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
    setIsLoading(true);
    setLoadError(null);
  }, []);

  // Derived aggregate metrics
  const summaryMetrics = useMemo(() => {
    if (!teamData) {
      return {
        total: 0,
        checkedIn: 0,
        checkedOut: 0,
        notCheckedIn: 0,
        requiresReview: 0,
        acknowledgedCount: 0,
        roamingCount: 0,
        totalEvents: 0,
      };
    }

    let checkedIn = 0;
    let checkedOut = 0;
    let notCheckedIn = 0;
    let requiresReview = 0;
    let acknowledgedCount = 0;

    for (const emp of teamData.employees) {
      const status = deriveEmployeeAttendanceStatus(emp);
      if (status.key === 'CHECKED_IN') {
        checkedIn += 1;
      } else if (status.key === 'CHECKED_OUT') {
        checkedOut += 1;
      } else {
        notCheckedIn += 1;
      }

      if (emp.review_status === 'REQUIRES_REVIEW') {
        requiresReview += 1;
      } else if (emp.review_status === 'ACKNOWLEDGED') {
        acknowledgedCount += 1;
      }
    }

    return {
      total: teamData.total_employees || teamData.employees.length,
      checkedIn,
      checkedOut,
      notCheckedIn,
      requiresReview,
      acknowledgedCount,
      roamingCount: teamData.summary.roaming_punch_count || 0,
      totalEvents: teamData.summary.total_events || 0,
    };
  }, [teamData]);

  // Filtered employees list
  const filteredEmployees = useMemo(() => {
    if (!teamData) return [];

    return teamData.employees.filter((emp) => {
      // Search matching name or employee code or department
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = (emp.employee_name || '').toLowerCase().includes(query);
        const matchesCode = (emp.employee_code || '').toLowerCase().includes(query);
        const matchesDept = (emp.department || '').toLowerCase().includes(query);
        if (!matchesName && !matchesCode && !matchesDept) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'ALL') {
        const status = deriveEmployeeAttendanceStatus(emp);
        if (statusFilter === 'CHECKED_IN' && status.key !== 'CHECKED_IN') return false;
        if (statusFilter === 'CHECKED_OUT' && status.key !== 'CHECKED_OUT') return false;
        if (statusFilter === 'NOT_CHECKED_IN' && status.key !== 'NOT_CHECKED_IN') return false;
        if (statusFilter === 'REQUIRES_REVIEW' && emp.review_status !== 'REQUIRES_REVIEW') return false;
        if (statusFilter === 'ACKNOWLEDGED' && emp.review_status !== 'ACKNOWLEDGED') return false;
      }

      return true;
    });
  }, [teamData, searchQuery, statusFilter]);

  // Handle modal escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEmployeeForDetail) {
        closeEmployeeDetail();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmployeeForDetail, closeEmployeeDetail]);

  // Early authorization rejection
  if (!hasAccess) {
    return (
      <main className="dashboard-wrapper">
        <div className="profile-container">
          <div className="alert-banner error" role="alert">
            <div className="alert-content">
              <span aria-hidden="true">⚠️</span>
              <span>
                Access Restricted: Team attendance overview is only available to Managers and
                Administrators.
              </span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Unlinked manager rejection
  if (isUnlinkedManager) {
    return (
      <main className="dashboard-wrapper">
        <div className="profile-container">
          <div className="alert-banner error" role="alert">
            <div className="alert-content">
              <span aria-hidden="true">⚠️</span>
              <span>
                Your manager user account is not linked to an employee staff profile. Please contact
                an administrator to link your account to your team department.
              </span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-wrapper team-attendance-wrapper">
      {/* Page Header */}
      <div className="dashboard-header-section team-header-section">
        <div className="dashboard-heading">
          <div className="team-heading-row">
            <h2>👥 Team Attendance Overview</h2>
            {teamData?.employees[0]?.department && (
              <span className="team-department-badge">
                Department: {teamData.employees[0].department}
              </span>
            )}
          </div>
          <p>
            Real-time attendance status, first check-in, last check-out, and punch logs for your
            authorized team.
          </p>
        </div>

        {/* Date Controls & Refresh */}
        <div className="team-controls-bar">
          <div className="team-date-picker-group">
            <label htmlFor="team-attendance-date" className="team-date-label">
              Date:
            </label>
            <input
              id="team-attendance-date"
              type="date"
              className="form-input team-date-input"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              aria-label="Select attendance date"
            />
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${selectedDate === getTodayString() ? 'active-date' : ''}`}
              onClick={() => handleDateChange(getTodayString())}
            >
              Today
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${selectedDate === getYesterdayString() ? 'active-date' : ''}`}
              onClick={() => handleDateChange(getYesterdayString())}
            >
              Yesterday
            </button>
          </div>

          <div className="team-actions-group">
            <button
              type="button"
              className="btn btn-secondary btn-refresh"
              onClick={handleManualRefresh}
              disabled={isLoading || isRefreshing}
              aria-label="Refresh team attendance"
            >
              {isRefreshing ? 'Refreshing...' : '🔄 Refresh'}
            </button>
            {onNavigateToDirectory && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onNavigateToDirectory}
              >
                Employee Directory
              </button>
            )}
            {onNavigateToAttendance && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onNavigateToAttendance}
              >
                Attendance Reports
              </button>
            )}
            {onNavigateToLeaves && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onNavigateToLeaves}
              >
                Leaves & Holidays
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Data Availability / Last Refreshed Notice */}
      <div className="team-meta-bar">
        <span className="team-meta-item">
          📅 Showing records for: <strong>{selectedDate}</strong>
        </span>
        {lastRefreshedAt && (
          <span className="team-meta-item text-muted">
            🕒 Last refreshed: {lastRefreshedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error Alert Banner */}
      {loadError && (
        <div className="alert-banner error" role="alert">
          <div className="alert-content">
            <span aria-hidden="true">⚠️</span>
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div
          role="progressbar"
          aria-label="Loading team attendance..."
          className="dashboard-loading-state"
        >
          <div className="spinner" aria-hidden="true" />
          <p>Loading authorized team attendance data...</p>
        </div>
      ) : (
        <>
          {/* Team Summary Cards */}
          <div className="team-summary-cards-grid">
            <div className="team-summary-card">
              <span className="team-summary-icon" aria-hidden="true">
                👥
              </span>
              <div className="team-summary-info">
                <span className="team-summary-count">{summaryMetrics.total}</span>
                <span className="team-summary-label">Total Team Members</span>
              </div>
            </div>

            <div className="team-summary-card card-checked-in">
              <span className="team-summary-icon" aria-hidden="true">
                🟢
              </span>
              <div className="team-summary-info">
                <span className="team-summary-count text-success">{summaryMetrics.checkedIn}</span>
                <span className="team-summary-label">Checked In</span>
              </div>
            </div>

            <div className="team-summary-card card-checked-out">
              <span className="team-summary-icon" aria-hidden="true">
                🔵
              </span>
              <div className="team-summary-info">
                <span className="team-summary-count text-info">{summaryMetrics.checkedOut}</span>
                <span className="team-summary-label">Checked Out</span>
              </div>
            </div>

            <div className="team-summary-card card-not-checked-in">
              <span className="team-summary-icon" aria-hidden="true">
                ⚪
              </span>
              <div className="team-summary-info">
                <span className="team-summary-count text-muted">{summaryMetrics.notCheckedIn}</span>
                <span className="team-summary-label">Not Yet Checked In</span>
              </div>
            </div>

            <div className="team-summary-card card-requires-review">
              <span className="team-summary-icon" aria-hidden="true">
                ⚠️
              </span>
              <div className="team-summary-info">
                <span className="team-summary-count text-warning">
                  {summaryMetrics.requiresReview}
                </span>
                <span className="team-summary-label">Requires Review</span>
              </div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="team-table-controls">
            <div className="team-search-box">
              <input
                type="search"
                className="form-input team-search-input"
                placeholder="Search by name, employee code, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search team members"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                >
                  ×
                </button>
              )}
            </div>

            <div className="team-filter-buttons" role="group" aria-label="Filter by attendance status">
              <button
                type="button"
                className={`filter-btn ${statusFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setStatusFilter('ALL')}
              >
                All ({summaryMetrics.total})
              </button>
              <button
                type="button"
                className={`filter-btn ${statusFilter === 'CHECKED_IN' ? 'active' : ''}`}
                onClick={() => setStatusFilter('CHECKED_IN')}
              >
                Checked In ({summaryMetrics.checkedIn})
              </button>
              <button
                type="button"
                className={`filter-btn ${statusFilter === 'CHECKED_OUT' ? 'active' : ''}`}
                onClick={() => setStatusFilter('CHECKED_OUT')}
              >
                Checked Out ({summaryMetrics.checkedOut})
              </button>
              <button
                type="button"
                className={`filter-btn ${statusFilter === 'NOT_CHECKED_IN' ? 'active' : ''}`}
                onClick={() => setStatusFilter('NOT_CHECKED_IN')}
              >
                Not In ({summaryMetrics.notCheckedIn})
              </button>
              {summaryMetrics.requiresReview > 0 && (
                <button
                  type="button"
                  className={`filter-btn filter-warning ${statusFilter === 'REQUIRES_REVIEW' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('REQUIRES_REVIEW')}
                >
                  ⚠️ Review ({summaryMetrics.requiresReview})
                </button>
              )}
              {summaryMetrics.acknowledgedCount > 0 && (
                <button
                  type="button"
                  className={`filter-btn filter-success ${statusFilter === 'ACKNOWLEDGED' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('ACKNOWLEDGED')}
                >
                  ✓ Acknowledged ({summaryMetrics.acknowledgedCount})
                </button>
              )}
            </div>
          </div>

          {/* Team Attendance Table */}
          {filteredEmployees.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No team members match the selected criteria.</p>
              <p className="empty-subtitle">
                {searchQuery || statusFilter !== 'ALL'
                  ? 'Try clearing search or changing the status filter.'
                  : 'No active team members are assigned to your department roster.'}
              </p>
              {(searchQuery || statusFilter !== 'ALL') && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('ALL');
                  }}
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="mbiotrack-table team-attendance-table">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Department & Office</th>
                    <th scope="col">Today's Status</th>
                    <th scope="col">First Check-in</th>
                    <th scope="col">Last Check-out</th>
                    <th scope="col">Latest Punch</th>
                    <th scope="col" className="text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => {
                    const status = deriveEmployeeAttendanceStatus(emp);
                    const hasExceptions =
                      emp.review_status === 'REQUIRES_REVIEW' || emp.has_roaming;

                    // Compute first check-in and last check-out times
                    const firstInPunch = emp.punches?.find((p) => p.punch_type === 'CHECK_IN');
                    const lastOutPunch = emp.punches
                      ? [...emp.punches].reverse().find((p) => p.punch_type === 'CHECK_OUT')
                      : undefined;
                    const latestPunch = emp.punches && emp.punches.length > 0
                      ? emp.punches[emp.punches.length - 1]
                      : undefined;

                    return (
                      <tr
                        key={emp.employee_id}
                        className={hasExceptions ? 'row-requires-review' : ''}
                      >
                        <td>
                          <div className="employee-info-cell">
                            <span className="avatar-circle-sm" aria-hidden="true">
                              {emp.employee_name
                                ? emp.employee_name
                                    .split(' ')
                                    .map((n) => n[0])
                                    .slice(0, 2)
                                    .join('')
                                    .toUpperCase()
                                : 'EM'}
                            </span>
                            <div className="employee-text-meta">
                              <span className="employee-full-name">{emp.employee_name}</span>
                              <span className="employee-sub-code">{emp.employee_code}</span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <div className="dept-office-cell">
                            <span className="dept-name">{emp.department || '—'}</span>
                            <span className="office-sub-name">
                              {emp.assigned_office_name
                                ? `🏢 ${emp.assigned_office_name}`
                                : 'No Office Assigned'}
                            </span>
                          </div>
                        </td>

                        <td>
                          <div className="status-cell-wrapper">
                            <span className={`team-status-pill ${status.pillClass}`}>
                              <span className="status-bullet" aria-hidden="true" />
                              {status.label}
                            </span>
                            {hasExceptions && (
                              <span
                                className={`exception-badge ${
                                  emp.review_status === 'ACKNOWLEDGED'
                                    ? 'acknowledged'
                                    : 'requires-review'
                                }`}
                                title={emp.review_reason || 'Out-of-assignment roaming punch'}
                              >
                                {emp.review_status === 'ACKNOWLEDGED'
                                  ? '✓ Acknowledged'
                                  : `⚠️ ${emp.review_reason || 'Requires Review'}`}
                              </span>
                            )}
                          </div>
                        </td>

                        <td>
                          <span className="punch-time-cell">
                            {formatTime(firstInPunch?.event_timestamp || emp.first_punch)}
                          </span>
                        </td>

                        <td>
                          <span className="punch-time-cell">
                            {formatTime(lastOutPunch?.event_timestamp)}
                          </span>
                        </td>

                        <td>
                          {latestPunch ? (
                            <div className="latest-punch-meta">
                              <span className="punch-time-cell">
                                {formatTime(latestPunch.event_timestamp)}
                              </span>
                              <span
                                className={`punch-badge-xs ${
                                   latestPunch.punch_type === 'CHECK_IN'
                                    ? 'badge-in'
                                    : 'badge-out'
                                }`}
                              >
                                {latestPunch.punch_type}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEmployeeDetail(emp)}
                            title={`Inspect punch details for ${emp.employee_name}`}
                          >
                            View Punches ({emp.punch_count})
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Employee Punch Detail Modal */}
      {selectedEmployeeForDetail && (
        <div
          className="modal-backdrop"
          onClick={closeEmployeeDetail}
          role="presentation"
        >
          <div
            className="modal-content team-punch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-detail-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div>
                <h3 id="team-detail-modal-title">
                  {selectedEmployeeForDetail.employee_name} ({selectedEmployeeForDetail.employee_code})
                </h3>
                <p className="modal-subtitle">
                  {selectedEmployeeForDetail.department} • Attendance Details for {selectedDate}
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={closeEmployeeDetail}
                aria-label="Close punch details modal"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body team-detail-modal-body">
              {/* Overview Summary Strip */}
              <div className="employee-detail-strip">
                <div className="strip-item">
                  <span className="strip-label">Status</span>
                  <span
                    className={`team-status-pill ${
                      deriveEmployeeAttendanceStatus(selectedEmployeeForDetail).pillClass
                    }`}
                  >
                    {deriveEmployeeAttendanceStatus(selectedEmployeeForDetail).label}
                  </span>
                </div>
                <div className="strip-item">
                  <span className="strip-label">Total Punches</span>
                  <span className="strip-value">{selectedEmployeeForDetail.punch_count}</span>
                </div>
                <div className="strip-item">
                  <span className="strip-label">First Punch</span>
                  <span className="strip-value">
                    {formatTime(selectedEmployeeForDetail.first_punch)}
                  </span>
                </div>
                <div className="strip-item">
                  <span className="strip-label">Last Punch</span>
                  <span className="strip-value">
                    {formatTime(selectedEmployeeForDetail.last_punch)}
                  </span>
                </div>
                {selectedEmployeeForDetail.has_roaming && (
                  <div className="strip-item">
                    <span className="strip-label">Roaming Events</span>
                    <span className="strip-value text-warning">
                      ⚠️ {selectedEmployeeForDetail.roaming_count} Roaming
                    </span>
                  </div>
                )}
              </div>

              {/* Exception Note if present */}
              {selectedEmployeeForDetail.review_reason && (
                <div className="team-exception-callout" role="note">
                  <span aria-hidden="true">⚠️</span>
                  <span>
                    <strong>Review Notice:</strong> {selectedEmployeeForDetail.review_reason}
                  </span>
                </div>
              )}

              {/* Roaming Exception Review Section */}
              {selectedEmployeeForDetail.has_roaming && (
                <div className="team-exception-review-panel">
                  <div className="panel-header-row">
                    <h4 className="detail-section-heading">
                      ⚠️ Attendance Exception Review (GOV-08)
                    </h4>
                    <span
                      className={`exception-badge ${
                        selectedEmployeeForDetail.review_status === 'ACKNOWLEDGED'
                          ? 'acknowledged'
                          : 'requires-review'
                      }`}
                    >
                      {selectedEmployeeForDetail.review_status === 'ACKNOWLEDGED'
                        ? '✓ Acknowledged'
                        : '⚠️ Requires Review'}
                    </span>
                  </div>

                  {selectedEmployeeForDetail.review_status === 'ACKNOWLEDGED' ? (
                    <div className="exception-acknowledged-box">
                      <div className="alert-content-ack">
                        <span className="ack-icon" aria-hidden="true">✓</span>
                        <div className="ack-body">
                          <strong>Exception Acknowledged</strong>
                          <p className="ack-text">
                            This roaming exception was reviewed and acknowledged under compliance policy GOV-08.
                            Raw physical punch records remain unchanged.
                          </p>
                          <div className="ack-meta-row">
                            <span>
                              <strong>Reviewer:</strong> {selectedEmployeeForDetail.latest_review?.reviewer_name || 'Manager'}
                              {selectedEmployeeForDetail.latest_review?.reviewer_email && ` (${selectedEmployeeForDetail.latest_review.reviewer_email})`}
                            </span>
                            {selectedEmployeeForDetail.latest_review?.created_at && (
                              <span>
                                <strong>Date:</strong> {formatDateTime(selectedEmployeeForDetail.latest_review.created_at)}
                              </span>
                            )}
                          </div>
                          {selectedEmployeeForDetail.latest_review?.review_notes && (
                            <div className="ack-notes-box">
                              <strong>Supervisor Notes:</strong>
                              <p>{selectedEmployeeForDetail.latest_review.review_notes}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="history-toggle-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleToggleReviewHistory}
                        >
                          {showReviewHistory ? 'Hide Review History' : '📜 View Review History'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="exception-action-box">
                      <p className="exception-action-desc">
                        {selectedEmployeeForDetail.review_reason ||
                          `Employee recorded ${selectedEmployeeForDetail.roaming_count} roaming punches outside their assigned work office.`}
                        {' '}Record your supervisory review to acknowledge awareness of this attendance anomaly.
                      </p>

                      {reviewSubmitError && (
                        <div className="alert-banner error" role="alert">
                          <div className="alert-content">
                            <span aria-hidden="true">⚠️</span>
                            <span>{reviewSubmitError}</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={handleAcknowledgeException}
                          >
                            Retry
                          </button>
                        </div>
                      )}

                      {reviewSubmitSuccess && (
                        <div className="alert-banner success" role="alert">
                          <div className="alert-content">
                            <span aria-hidden="true">✓</span>
                            <span>{reviewSubmitSuccess}</span>
                          </div>
                        </div>
                      )}

                      {!reviewSubmitSuccess && (
                        <div className="exception-review-form">
                          <label htmlFor="exception-review-notes" className="form-label">
                            Supervisor Review Notes (Optional, max 1000 characters):
                          </label>
                          <textarea
                            id="exception-review-notes"
                            className="form-textarea review-notes-input"
                            rows={3}
                            maxLength={1000}
                            placeholder="Add context (e.g., Authorized client visit, emergency site coverage, or confirmed temporary reassignment)..."
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            disabled={isSubmittingReview}
                          />
                          <div className="form-helper-row">
                            <span className="char-count">{reviewNotes.length} / 1000</span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm btn-acknowledge"
                              onClick={handleAcknowledgeException}
                              disabled={isSubmittingReview}
                            >
                              {isSubmittingReview ? 'Acknowledging...' : 'Acknowledge Exception'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Historical Review Chain */}
                  {showReviewHistory && (
                    <div className="review-history-container">
                      <h5 className="history-heading">Audit Trail: Past Review Actions</h5>
                      {isLoadingHistory ? (
                        <div className="history-loading" role="progressbar" aria-label="Loading review history...">
                          Loading review records...
                        </div>
                      ) : historyError ? (
                        <div className="alert-banner error">
                          <span>{historyError}</span>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={handleToggleReviewHistory}
                          >
                            Retry
                          </button>
                        </div>
                      ) : reviewHistory && reviewHistory.length > 0 ? (
                        <ul className="history-list">
                          {reviewHistory.map((rev) => (
                            <li key={rev.id} className="history-item">
                              <div className="history-header">
                                <span className="history-badge">✓ {rev.review_status}</span>
                                <span className="history-time">{formatDateTime(rev.created_at)}</span>
                              </div>
                              <div className="history-meta">
                                <strong>Reviewed by:</strong> {rev.reviewer_name} ({rev.reviewer_email})
                              </div>
                              {rev.review_notes && (
                                <p className="history-notes">"{rev.review_notes}"</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="history-empty">No prior review actions recorded for this date.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Punches Timeline Table */}
              <h4 className="detail-section-heading">Detailed Punch Log</h4>
              {selectedEmployeeForDetail.punches &&
              selectedEmployeeForDetail.punches.length > 0 ? (
                <div className="table-responsive">
                  <table className="mbiotrack-table detail-punches-table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Type</th>
                        <th scope="col">Time</th>
                        <th scope="col">Office</th>
                        <th scope="col">Device</th>
                        <th scope="col">Assignment Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEmployeeForDetail.punches.map((punch: DailyPunchDetail, idx: number) => (
                        <tr key={punch.id || idx}>
                          <td>{idx + 1}</td>
                          <td>
                            <span
                              className={`punch-badge-sm ${
                                punch.punch_type === 'CHECK_IN' ? 'badge-in' : 'badge-out'
                              }`}
                            >
                              {punch.punch_type}
                            </span>
                          </td>
                          <td>
                            <strong>{formatTime(punch.event_timestamp)}</strong>
                            <span className="sub-timestamp">
                              {formatDateTime(punch.event_timestamp)}
                            </span>
                          </td>
                          <td>{punch.office_name || punch.office_code || '—'}</td>
                          <td>
                            {punch.device_name || punch.device_code || `Device #${punch.device_id}`}
                          </td>
                          <td>
                            {punch.is_roaming ? (
                              <span className="roaming-badge warning">⚠️ Roaming</span>
                            ) : (
                              <span className="roaming-badge success">✓ In-Assignment</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <p className="empty-title">No punches recorded today.</p>
                  <p className="empty-subtitle">
                    This employee has not recorded any check-in or check-out events on {selectedDate}.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={closeEmployeeDetail}
              >
                ← Back to Team Overview
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
