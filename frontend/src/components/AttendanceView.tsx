import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadAttendanceReportCsv,
  getAttendanceRecords,
  getAttendanceReport,
  getDailyAttendanceOperations,
  recordAttendancePunch,
} from '../api/attendanceApi';
import { ApiError } from '../api/apiError';
import { getOffices } from '../api/officeApi';
import { AttendanceCorrectionModal } from './AttendanceCorrectionModal';
import { PunchModal } from './PunchModal';
import type {
  AttendanceCorrectionType,
  AttendanceEventDetail,
  AttendanceFilterParams,
  AttendancePunchCreatePayload,
  AttendanceReportFilterParams,
  AttendanceReportResponse,
  DailyAttendanceOperationsResponse,
  DailyOperationsFilterParams,
  DailyPunchDetail,
  EmployeeDailyAttendanceItem,
} from '../types/attendance';
import type { User } from '../types/auth';
import type { Office } from '../types/office';
import './components.css';

export interface AttendanceViewProps {
  currentUser: User;
  sessionEpoch: number;
  initialTab?: 'operations' | 'reports' | 'events';
  onNavigateToDirectory?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToLeaves?: () => void;
  onNavigateToDashboard?: () => void;
}

const PAGE_SIZE = 25;

const getTodayUtc = () => new Date().toISOString().split('T')[0];
const getNDaysAgoUtc = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
};

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  currentUser,
  sessionEpoch,
  initialTab = 'operations',
  onNavigateToDirectory,
  onNavigateToProfile,
  onNavigateToLeaves,
  onNavigateToDashboard,
}) => {
  const isEmployee = currentUser.role === 'EMPLOYEE';
  const isAdmin = currentUser.role === 'ADMIN';
  const isManager = currentUser.role === 'MANAGER';

  // Active top-level subtab: 'operations' (Daily Operations) vs 'reports' (Reports & Export) vs 'events' (Raw Event Feed)
  const [activeTab, setActiveTab] = useState<'operations' | 'reports' | 'events'>(initialTab);

  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  // Offices lookup for select dropdown
  const [officesList, setOfficesList] = useState<Office[]>([]);
  useEffect(() => {
    let isMounted = true;
    if (currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER') {
      getOffices()
        .then((offices) => {
          if (isMounted) setOfficesList(offices);
        })
        .catch(() => {
          // Non-critical; fallback to empty list
        });
    }
    return () => {
      isMounted = false;
    };
  }, [currentUser.role]);

  // =========================================================================
  // 1. Daily Operations & Summary State (Slice 7)
  // =========================================================================
  const [opDate, setOpDate] = useState<string>(getTodayUtc);
  const [opOfficeId, setOpOfficeId] = useState<string>('');
  const [opEmployeeId, setOpEmployeeId] = useState<string>('');

  const [appliedOpFilters, setAppliedOpFilters] = useState<{
    date: string;
    officeId?: number;
    employeeId?: number;
  }>({
    date: getTodayUtc(),
  });

  const [opData, setOpData] = useState<DailyAttendanceOperationsResponse | null>(null);
  const [isOpLoading, setIsOpLoading] = useState<boolean>(true);
  const [opError, setOpError] = useState<string | null>(null);
  const [opOffset, setOpOffset] = useState<number>(0);
  const [opReloadTrigger, setOpReloadTrigger] = useState<number>(0);

  // Selected employee item for punch inspection modal
  const [inspectingEmployee, setInspectingEmployee] = useState<EmployeeDailyAttendanceItem | null>(null);

  // Punch Modal & Quick-Punch State
  const [isPunchModalOpen, setIsPunchModalOpen] = useState<boolean>(false);
  const [punchModalDefaultType, setPunchModalDefaultType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [punchTargetEmployee, setPunchTargetEmployee] = useState<{ id: number; name: string; code: string } | null>(null);
  const [isPunchSubmitting, setIsPunchSubmitting] = useState<boolean>(false);
  const [punchServerError, setPunchServerError] = useState<string | null>(null);
  const [punchFeedback, setPunchFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Attendance Correction Modal State (Phase 2)
  const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState<boolean>(false);
  const [correctionTarget, setCorrectionTarget] = useState<{
    employeeId: number;
    employeeName: string;
    employeeCode: string;
    date: string;
    type: AttendanceCorrectionType;
    originalEventId?: number | null;
    punches: DailyPunchDetail[];
  } | null>(null);

  // Auto-dismiss punch feedback notification
  useEffect(() => {
    if (!punchFeedback) return;
    const timer = window.setTimeout(() => {
      setPunchFeedback(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [punchFeedback]);

  // Load Daily Operations data when filters, pagination, or tab changes
  useEffect(() => {
    if (activeTab !== 'operations') return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    const params: DailyOperationsFilterParams = {
      date: appliedOpFilters.date,
      limit: PAGE_SIZE,
      offset: opOffset,
    };

    if (appliedOpFilters.officeId !== undefined) {
      params.office_id = appliedOpFilters.officeId;
    }
    if (!isEmployee && appliedOpFilters.employeeId !== undefined) {
      params.employee_id = appliedOpFilters.employeeId;
    }

    getDailyAttendanceOperations(params)
      .then((data) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setOpData(data);
        setOpError(null);
        setIsOpLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to retrieve daily attendance operations.';
        setOpError(msg);
        setOpData(null);
        setIsOpLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, appliedOpFilters, opOffset, isEmployee, opReloadTrigger]);

  const handleApplyOpFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsOpLoading(true);
    setOpError(null);
    setOpOffset(0);

    const nextApplied: typeof appliedOpFilters = {
      date: opDate.trim() || getTodayUtc(),
    };

    if (opOfficeId.trim()) {
      const parsed = parseInt(opOfficeId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.officeId = parsed;
      }
    }

    if (!isEmployee && opEmployeeId.trim()) {
      const parsed = parseInt(opEmployeeId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.employeeId = parsed;
      }
    }

    setAppliedOpFilters(nextApplied);
  };

  const handleClearOpFilters = () => {
    const today = getTodayUtc();
    setOpDate(today);
    setOpOfficeId('');
    setOpEmployeeId('');
    setOpOffset(0);
    setAppliedOpFilters({ date: today });
  };

  const hasActiveOpFilters = useMemo(() => {
    return (
      opDate !== getTodayUtc() ||
      Boolean(opOfficeId.trim()) ||
      Boolean(opEmployeeId.trim()) ||
      appliedOpFilters.date !== getTodayUtc() ||
      appliedOpFilters.officeId !== undefined ||
      appliedOpFilters.employeeId !== undefined
    );
  }, [opDate, opOfficeId, opEmployeeId, appliedOpFilters]);

  // =========================================================================
  // 2. Attendance Reports & CSV Export State (Slice 8)
  // =========================================================================
  const defaultReportStartDate = useMemo(() => getNDaysAgoUtc(6), []);
  const defaultReportEndDate = useMemo(() => getTodayUtc(), []);

  const [reportStartDate, setReportStartDate] = useState<string>(() => getNDaysAgoUtc(6));
  const [reportEndDate, setReportEndDate] = useState<string>(getTodayUtc);
  const [reportOfficeId, setReportOfficeId] = useState<string>('');
  const [reportDepartment, setReportDepartment] = useState<string>('');
  const [reportEmployeeId, setReportEmployeeId] = useState<string>('');

  const [appliedReportFilters, setAppliedReportFilters] = useState<{
    start_date?: string;
    end_date?: string;
    office_id?: number;
    department?: string;
    employee_id?: number;
  }>(() => ({
    start_date: getNDaysAgoUtc(6),
    end_date: getTodayUtc(),
  }));

  const [reportData, setReportData] = useState<AttendanceReportResponse | null>(null);
  const [isReportLoading, setIsReportLoading] = useState<boolean>(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportOffset, setReportOffset] = useState<number>(0);
  const [reportReloadTrigger, setReportReloadTrigger] = useState<number>(0);

  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  const managerDepartment = useMemo(() => {
    if (!isManager || !reportData) return '';
    const itemWithDept = reportData.items.find((it) => it.department);
    return itemWithDept?.department || '';
  }, [isManager, reportData]);

  // Load Report data when filters, pagination, or tab changes
  useEffect(() => {
    if (activeTab !== 'reports') return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    const params: AttendanceReportFilterParams = {
      start_date: appliedReportFilters.start_date,
      end_date: appliedReportFilters.end_date,
      limit: PAGE_SIZE,
      offset: reportOffset,
    };

    if (appliedReportFilters.office_id !== undefined) {
      params.office_id = appliedReportFilters.office_id;
    }
    if (isAdmin && appliedReportFilters.department) {
      params.department = appliedReportFilters.department;
    }
    if (!isEmployee && appliedReportFilters.employee_id !== undefined) {
      params.employee_id = appliedReportFilters.employee_id;
    }

    getAttendanceReport(params)
      .then((data) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setReportData(data);
        setReportError(null);
        setIsReportLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to retrieve attendance report.';
        setReportError(msg);
        setReportData(null);
        setIsReportLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, appliedReportFilters, reportOffset, isEmployee, isAdmin, reportReloadTrigger]);

  const handleApplyReportFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setValidationWarning(null);

    const s = reportStartDate.trim();
    const ed = reportEndDate.trim();

    if (!s || !ed) {
      setValidationWarning('Both start date and end date are required.');
      return;
    }

    if (s > ed) {
      setValidationWarning('Start date cannot be after end date.');
      return;
    }

    const startObj = new Date(s);
    const endObj = new Date(ed);
    const diffTime = endObj.getTime() - startObj.getTime();
    const diffDays = Math.round(diffTime / (1000 * 3600 * 24)) + 1;
    if (diffDays > 31) {
      setValidationWarning('Date range exceeds 31-day limit. Please select a range of up to 31 days.');
      return;
    }

    setIsReportLoading(true);
    setReportError(null);
    setReportOffset(0);

    const nextApplied: typeof appliedReportFilters = {
      start_date: s,
      end_date: ed,
    };

    if (reportOfficeId.trim()) {
      const parsed = parseInt(reportOfficeId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.office_id = parsed;
      }
    }

    if (isAdmin && reportDepartment.trim()) {
      nextApplied.department = reportDepartment.trim();
    }

    if (!isEmployee && reportEmployeeId.trim()) {
      const parsed = parseInt(reportEmployeeId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.employee_id = parsed;
      }
    }

    setAppliedReportFilters(nextApplied);
  };

  const handleClearReportFilters = () => {
    const sDate = getNDaysAgoUtc(6);
    const eDate = getTodayUtc();
    setReportStartDate(sDate);
    setReportEndDate(eDate);
    setReportOfficeId('');
    setReportDepartment('');
    setReportEmployeeId('');
    setReportOffset(0);
    setValidationWarning(null);
    setIsReportLoading(true);
    setAppliedReportFilters({
      start_date: sDate,
      end_date: eDate,
    });
  };

  const hasActiveReportFilters = useMemo(() => {
    return (
      reportStartDate !== defaultReportStartDate ||
      reportEndDate !== defaultReportEndDate ||
      Boolean(reportOfficeId.trim()) ||
      Boolean(reportDepartment.trim()) ||
      Boolean(reportEmployeeId.trim()) ||
      appliedReportFilters.start_date !== defaultReportStartDate ||
      appliedReportFilters.end_date !== defaultReportEndDate ||
      appliedReportFilters.office_id !== undefined ||
      appliedReportFilters.department !== undefined ||
      appliedReportFilters.employee_id !== undefined
    );
  }, [
    reportStartDate,
    reportEndDate,
    reportOfficeId,
    reportDepartment,
    reportEmployeeId,
    appliedReportFilters,
    defaultReportStartDate,
    defaultReportEndDate,
  ]);

  const handleExportCsv = async () => {
    try {
      setIsExportingCsv(true);
      setExportError(null);

      const params: AttendanceReportFilterParams = {
        start_date: appliedReportFilters.start_date,
        end_date: appliedReportFilters.end_date,
      };
      if (appliedReportFilters.office_id !== undefined) {
        params.office_id = appliedReportFilters.office_id;
      }
      if (isAdmin && appliedReportFilters.department) {
        params.department = appliedReportFilters.department;
      }
      if (!isEmployee && appliedReportFilters.employee_id !== undefined) {
        params.employee_id = appliedReportFilters.employee_id;
      }

      const blob = await downloadAttendanceReportCsv(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const sDate = appliedReportFilters.start_date || 'start';
      const eDate = appliedReportFilters.end_date || 'end';
      link.download = `attendance_report_${sDate}_${eDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export attendance report CSV.';
      setExportError(msg);
    } finally {
      setIsExportingCsv(false);
    }
  };

  // =========================================================================
  // 3. Event Feed State (Slice 5)
  // =========================================================================
  const [records, setRecords] = useState<AttendanceEventDetail[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isEventLoading, setIsEventLoading] = useState<boolean>(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventReloadTrigger, setEventReloadTrigger] = useState<number>(0);

  const [eventOffset, setEventOffset] = useState<number>(0);

  const [employeeIdFilter, setEmployeeIdFilter] = useState<string>('');
  const [officeIdFilter, setOfficeIdFilter] = useState<string>('');
  const [punchTypeFilter, setPunchTypeFilter] = useState<string>('ALL');
  const [roamingFilter, setRoamingFilter] = useState<string>('ALL');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');

  const [appliedEventFilters, setAppliedEventFilters] = useState<{
    employeeId?: number;
    officeId?: number;
    punchType?: string;
    isRoaming?: boolean;
    startDate?: string;
    endDate?: string;
  }>({});

  useEffect(() => {
    if (activeTab !== 'events') return;

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    const params: AttendanceFilterParams = {
      limit: PAGE_SIZE,
      offset: eventOffset,
    };

    if (!isEmployee && appliedEventFilters.employeeId !== undefined) {
      params.employee_id = appliedEventFilters.employeeId;
    }
    if (appliedEventFilters.officeId !== undefined) {
      params.office_id = appliedEventFilters.officeId;
    }
    if (appliedEventFilters.punchType) {
      params.punch_type = appliedEventFilters.punchType;
    }
    if (appliedEventFilters.isRoaming !== undefined) {
      params.is_roaming = appliedEventFilters.isRoaming;
    }
    if (appliedEventFilters.startDate) {
      params.start_date = appliedEventFilters.startDate;
    }
    if (appliedEventFilters.endDate) {
      params.end_date = appliedEventFilters.endDate;
    }

    getAttendanceRecords(params)
      .then((data) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setRecords(data.items);
        setTotal(data.total);
        setEventError(null);
        setIsEventLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to retrieve attendance records.';
        setEventError(msg);
        setRecords([]);
        setTotal(0);
        setIsEventLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, eventOffset, appliedEventFilters, isEmployee, eventReloadTrigger]);

  const handleApplyEventFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsEventLoading(true);
    setEventError(null);
    setEventOffset(0);

    const nextApplied: typeof appliedEventFilters = {};

    if (!isEmployee && employeeIdFilter.trim()) {
      const parsed = parseInt(employeeIdFilter.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.employeeId = parsed;
      }
    }

    if (officeIdFilter.trim()) {
      const parsed = parseInt(officeIdFilter.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        nextApplied.officeId = parsed;
      }
    }

    if (punchTypeFilter !== 'ALL') {
      nextApplied.punchType = punchTypeFilter;
    }

    if (roamingFilter === 'ROAMING') {
      nextApplied.isRoaming = true;
    } else if (roamingFilter === 'ASSIGNED') {
      nextApplied.isRoaming = false;
    }

    if (startDateFilter.trim()) {
      nextApplied.startDate = startDateFilter.trim();
    }
    if (endDateFilter.trim()) {
      nextApplied.endDate = endDateFilter.trim();
    }

    setAppliedEventFilters(nextApplied);
  };

  const handleClearEventFilters = () => {
    setIsEventLoading(true);
    setEventError(null);
    setEmployeeIdFilter('');
    setOfficeIdFilter('');
    setPunchTypeFilter('ALL');
    setRoamingFilter('ALL');
    setStartDateFilter('');
    setEndDateFilter('');
    setEventOffset(0);
    setAppliedEventFilters({});
  };

  const hasActiveEventFilters = useMemo(() => {
    return (
      Boolean(employeeIdFilter.trim()) ||
      Boolean(officeIdFilter.trim()) ||
      punchTypeFilter !== 'ALL' ||
      roamingFilter !== 'ALL' ||
      Boolean(startDateFilter.trim()) ||
      Boolean(endDateFilter.trim()) ||
      Object.keys(appliedEventFilters).length > 0
    );
  }, [
    employeeIdFilter,
    officeIdFilter,
    punchTypeFilter,
    roamingFilter,
    startDateFilter,
    endDateFilter,
    appliedEventFilters,
  ]);

  // Format timestamp helper
  const formatTimeOnly = (isoStr: string | null) => {
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

  const formatTimestamp = (isoStr: string | null) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  // Target employee daily attendance record for quick status calculation
  const currentEmployeeDailyRecord = useMemo<EmployeeDailyAttendanceItem | null>(() => {
    if (!opData?.employees || opData.employees.length === 0) return null;
    if (currentUser.employee_id) {
      const match = opData.employees.find((e) => e.employee_id === currentUser.employee_id);
      if (match) return match;
    }
    return isEmployee ? opData.employees[0] : null;
  }, [opData, currentUser.employee_id, isEmployee]);

  const employeePunchState = useMemo(() => {
    if (!currentEmployeeDailyRecord || !currentEmployeeDailyRecord.punches || currentEmployeeDailyRecord.punches.length === 0) {
      return {
        status: 'NOT_CHECKED_IN' as const,
        lastPunchTime: null as string | null,
        lastPunchType: null as string | null,
        recommendedAction: 'CHECK_IN' as const,
      };
    }
    const punches = currentEmployeeDailyRecord.punches;
    const lastPunch = punches[punches.length - 1];
    if (lastPunch.punch_type === 'CHECK_IN') {
      return {
        status: 'CHECKED_IN' as const,
        lastPunchTime: lastPunch.event_timestamp,
        lastPunchType: 'CHECK_IN' as const,
        recommendedAction: 'CHECK_OUT' as const,
      };
    } else {
      return {
        status: 'CHECKED_OUT' as const,
        lastPunchTime: lastPunch.event_timestamp,
        lastPunchType: 'CHECK_OUT' as const,
        recommendedAction: 'CHECK_IN' as const,
      };
    }
  }, [currentEmployeeDailyRecord]);

  const handleOpenPunchModal = (
    type?: 'CHECK_IN' | 'CHECK_OUT',
    target?: { id: number; name: string; code: string } | null
  ) => {
    setPunchServerError(null);
    setPunchModalDefaultType(type || employeePunchState.recommendedAction);
    setPunchTargetEmployee(
      target !== undefined
        ? target
        : currentUser.employee_id
        ? { id: currentUser.employee_id, name: currentUser.full_name, code: '' }
        : null
    );
    setIsPunchModalOpen(true);
  };

  const handlePunchSubmit = async (payload: AttendancePunchCreatePayload) => {
    if (isPunchSubmitting) return;
    setIsPunchSubmitting(true);
    setPunchServerError(null);

    try {
      const response = await recordAttendancePunch(payload);
      setIsPunchModalOpen(false);
      const actionLabel = response.punch_type === 'CHECK_IN' ? 'Check In' : 'Check Out';
      const timeStr = formatTimeOnly(response.event_timestamp);
      setPunchFeedback({
        type: 'success',
        message: `${actionLabel} recorded successfully at ${timeStr}${response.is_roaming ? ' (Out-of-assignment roaming recorded under GOV-08)' : ''}.`,
      });
      // Refresh daily operations, event feed, and reports
      setOpReloadTrigger((prev) => prev + 1);
      setEventReloadTrigger((prev) => prev + 1);
      setReportReloadTrigger((prev) => prev + 1);
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

  // View headings
  const opTitle = isEmployee
    ? 'My Daily Attendance'
    : isAdmin
      ? 'Organization Daily Attendance Operations'
      : 'Daily Attendance Operations';

  const opSubtitle = isEmployee
    ? 'Review your attendance punch activity and status for the selected date'
    : 'Daily attendance monitoring, roaming punch inspection, and employee review summary';

  const reportTitle = isEmployee
    ? 'My Attendance Reports'
    : isAdmin
      ? 'Organization Attendance Reports'
      : 'Attendance Reports';

  const reportSubtitle = isEmployee
    ? 'View your attendance summary across date ranges and export punch history'
    : 'Date-range attendance telemetry, punch summaries, roaming counts, and CSV export';

  const eventTitle = isEmployee
    ? 'My Attendance History'
    : isAdmin
      ? 'Organization Attendance Records'
      : 'Attendance Records';

  const eventSubtitle = isEmployee
    ? 'Comprehensive log of all biometric attendance punch events recorded for your profile'
    : 'Live biometric attendance event feed and normalized punch telemetry';

  return (
    <main className="attendance-view-wrapper dashboard-wrapper" role="main">
      {/* Employee top subnav when viewing profile / attendance */}
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
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="nav-tab-btn active"
          >
            My Attendance
          </button>
          {onNavigateToLeaves && (
            <button
              type="button"
              role="tab"
              aria-selected="false"
              className="nav-tab-btn"
              onClick={onNavigateToLeaves}
            >
              Leaves & Holidays
            </button>
          )}
        </div>
      )}

      {/* Attendance Punch Feedback Banner */}
      {punchFeedback && (
        <div
          className={`alert-banner ${punchFeedback.type === 'success' ? 'success' : 'error'}`}
          role="status"
          aria-live="polite"
        >
          <div className="alert-content">
            <span aria-hidden="true">{punchFeedback.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{punchFeedback.message}</span>
          </div>
          <button
            type="button"
            className="alert-close"
            aria-label="Close notification"
            onClick={() => setPunchFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Attendance Mode Subnav: Daily Operations vs Reports & Export vs Raw Event Feed */}
      <div className="attendance-tab-bar" role="tablist" aria-label="Attendance view modes">
        <button
          type="button"
          role="tab"
          id="tab-operations"
          aria-selected={activeTab === 'operations'}
          className={`nav-tab-btn ${activeTab === 'operations' ? 'active' : ''}`}
          onClick={() => {
            setIsOpLoading(true);
            setActiveTab('operations');
          }}
        >
          📊 Daily Operations & Summary
        </button>
        <button
          type="button"
          role="tab"
          id="tab-reports"
          aria-selected={activeTab === 'reports'}
          className={`nav-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => {
            setIsReportLoading(true);
            setActiveTab('reports');
          }}
        >
          📈 Reports & Export
        </button>
        <button
          type="button"
          role="tab"
          id="tab-events"
          aria-selected={activeTab === 'events'}
          className={`nav-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => {
            setIsEventLoading(true);
            setActiveTab('events');
          }}
        >
          📋 Event Feed (Raw Punches)
        </button>
      </div>

      {/* =====================================================================
          TAB 1: DAILY OPERATIONS & SUMMARY (SLICE 7)
          ===================================================================== */}
      {activeTab === 'operations' && (
        <section aria-labelledby="daily-ops-heading">
          {/* Header */}
          <div className="dashboard-header-section">
            <div className="dashboard-heading">
              <h2 id="daily-ops-heading">{opTitle}</h2>
              <p>{opSubtitle}</p>
            </div>
            <div className="dashboard-actions-group">
              {onNavigateToDirectory && !isEmployee && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onNavigateToDirectory}
                  title="Return to Employee Directory"
                >
                  ← Back to Directory
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsOpLoading(true);
                  setOpError(null);
                  setOpReloadTrigger((prev) => prev + 1);
                }}
                disabled={isOpLoading}
                title="Refresh daily operations"
              >
                🔄 Refresh
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleOpenPunchModal()}
                title="Record an attendance check-in or check-out punch"
              >
                ⏱️ Record Punch
              </button>
            </div>
          </div>

          {/* Quick-Punch Attendance Status Card */}
          <div className="punch-action-card" data-testid="punch-status-card">
            <div className="punch-action-status">
              <div
                className={`punch-status-indicator ${
                  employeePunchState.status === 'CHECKED_IN'
                    ? 'status-checked-in'
                    : employeePunchState.status === 'CHECKED_OUT'
                    ? 'status-checked-out'
                    : 'status-not-punched'
                }`}
                aria-hidden="true"
              >
                {employeePunchState.status === 'CHECKED_IN'
                  ? '🟢'
                  : employeePunchState.status === 'CHECKED_OUT'
                  ? '🔴'
                  : '⏳'}
              </div>
              <div className="punch-status-text">
                <div className="punch-status-title">
                  <span>{isEmployee ? 'My Attendance Status:' : `${currentUser.full_name}:`}</span>
                  <span className="punch-status-badge">
                    {employeePunchState.status === 'CHECKED_IN'
                      ? 'Currently Checked In'
                      : employeePunchState.status === 'CHECKED_OUT'
                      ? 'Currently Checked Out'
                      : 'Not Checked In Today'}
                  </span>
                </div>
                <span className="punch-status-desc">
                  {employeePunchState.status === 'CHECKED_IN' && employeePunchState.lastPunchTime
                    ? `Checked in at ${formatTimeOnly(employeePunchState.lastPunchTime)}`
                    : employeePunchState.status === 'CHECKED_OUT' && employeePunchState.lastPunchTime
                    ? `Checked out at ${formatTimeOnly(employeePunchState.lastPunchTime)}`
                    : 'No punches recorded for today yet'}
                </span>
              </div>
            </div>

            <div className="punch-action-controls">
              {employeePunchState.recommendedAction === 'CHECK_IN' ? (
                <button
                  type="button"
                  className="btn btn-punch-in"
                  onClick={() => handleOpenPunchModal('CHECK_IN')}
                  title="Submit a Check In punch"
                >
                  🟢 Check In
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-punch-out"
                  onClick={() => handleOpenPunchModal('CHECK_OUT')}
                  title="Submit a Check Out punch"
                >
                  🔴 Check Out
                </button>
              )}
              {!isEmployee && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleOpenPunchModal(undefined, null)}
                  title="Record punch for an employee"
                >
                  ⏱️ Manual Punch...
                </button>
              )}
            </div>
          </div>

          {/* Filter Toolbar */}
          <section className="toolbar-card attendance-filter-card" aria-label="Daily operations filters">
            <form className="attendance-filter-form" onSubmit={handleApplyOpFilters}>
              <div className="attendance-filter-grid">
                {/* Date Picker */}
                <div className="filter-field">
                  <label htmlFor="filter-op-date" className="filter-label">
                    Attendance Date
                  </label>
                  <input
                    id="filter-op-date"
                    type="date"
                    className="filter-input"
                    value={opDate}
                    onChange={(e) => setOpDate(e.target.value)}
                    aria-label="Filter by attendance date"
                    required
                  />
                </div>

                {/* Office Filter */}
                <div className="filter-field">
                  <label htmlFor="filter-op-office" className="filter-label">
                    Office Filter
                  </label>
                  {officesList.length > 0 ? (
                    <select
                      id="filter-op-office"
                      className="filter-select"
                      value={opOfficeId}
                      onChange={(e) => setOpOfficeId(e.target.value)}
                      aria-label="Filter by office"
                    >
                      <option value="">All Offices</option>
                      {officesList.map((off) => (
                        <option key={off.id} value={off.id}>
                          {off.name} ({off.code})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="filter-op-office"
                      type="number"
                      min="1"
                      className="filter-input"
                      placeholder="e.g. 1"
                      value={opOfficeId}
                      onChange={(e) => setOpOfficeId(e.target.value)}
                      aria-label="Filter by office ID"
                    />
                  )}
                </div>

                {/* Employee Filter (Admin/Manager only) */}
                {!isEmployee && (
                  <div className="filter-field">
                    <label htmlFor="filter-op-employee" className="filter-label">
                      Employee ID
                    </label>
                    <input
                      id="filter-op-employee"
                      type="number"
                      min="1"
                      className="filter-input"
                      placeholder="e.g. 101"
                      value={opEmployeeId}
                      onChange={(e) => setOpEmployeeId(e.target.value)}
                      aria-label="Filter by employee ID"
                    />
                  </div>
                )}
              </div>

              <div className="attendance-filter-actions">
                <button type="submit" className="btn btn-primary" disabled={isOpLoading}>
                  Apply Filters
                </button>
                {hasActiveOpFilters && (
                  <button
                    type="button"
                    className="btn-clear-filters"
                    onClick={handleClearOpFilters}
                    disabled={isOpLoading}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* Error Banner */}
          {opError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '1.25rem' }}>
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{opError}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setIsOpLoading(true);
                  setOpError(null);
                  setOpReloadTrigger((prev) => prev + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {isOpLoading ? (
            <div className="table-card" aria-busy="true" aria-live="polite">
              <div className="table-state-container">
                <div className="table-spinner" role="progressbar" aria-label="Loading daily operations" />
                <div className="table-state-title">Loading Daily Operations...</div>
                <div className="table-state-description">Aggregating attendance telemetry for the selected date</div>
              </div>
            </div>
          ) : !opData ? (
            <div className="table-card" role="region" aria-label="No data">
              <div className="table-state-container">
                <div className="table-state-icon" aria-hidden="true">📅</div>
                <div className="table-state-title">Unable to Display Daily Operations</div>
                <div className="table-state-description">Please verify your connection and retry.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Daily Summary Cards Grid */}
              <div className="attendance-summary-grid" role="region" aria-label="Daily attendance summary cards">
                {/* 1. Total Recorded Attendance Events */}
                <div className="attendance-summary-card" data-testid="card-total-events">
                  <div className="attendance-summary-icon events" aria-hidden="true">
                    ⚡
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{opData.summary.total_events}</span>
                    <span className="attendance-summary-label">Total Events</span>
                  </div>
                </div>

                {/* 2. Employees With Recorded Punches */}
                <div className="attendance-summary-card" data-testid="card-employees-with-punches">
                  <div className="attendance-summary-icon punches" aria-hidden="true">
                    👥
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{opData.summary.employees_with_punches}</span>
                    <span className="attendance-summary-label">With Punches</span>
                  </div>
                </div>

                {/* 3. Employees With No Recorded Punches (Neutral Label) */}
                <div className="attendance-summary-card" data-testid="card-employees-without-punches">
                  <div className="attendance-summary-icon nopunch" aria-hidden="true">
                    ⏳
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{opData.summary.employees_without_punches}</span>
                    <span className="attendance-summary-label">No Punch Recorded</span>
                  </div>
                </div>

                {/* 4. Requires Review */}
                <div
                  className={`attendance-summary-card ${
                    opData.summary.requires_review_count > 0 ? 'highlight-warning' : ''
                  }`}
                  data-testid="card-requires-review"
                >
                  <div className="attendance-summary-icon review" aria-hidden="true">
                    ⚠️
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{opData.summary.requires_review_count}</span>
                    <span className="attendance-summary-label">Requires Review</span>
                  </div>
                </div>

                {/* 5. Roaming Punches (GOV-08) */}
                <div
                  className={`attendance-summary-card ${
                    opData.summary.roaming_punch_count > 0 ? 'highlight-roaming' : ''
                  }`}
                  data-testid="card-roaming-punches"
                >
                  <div className="attendance-summary-icon roaming" aria-hidden="true">
                    🌐
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{opData.summary.roaming_punch_count}</span>
                    <span className="attendance-summary-label">Roaming Punches</span>
                  </div>
                </div>
              </div>

              {/* Employee-wise Attendance Table */}
              {opData.employees.length === 0 ? (
                <div className="table-card" role="region" aria-label="Empty daily operations">
                  <div className="table-state-container">
                    <div className="table-state-icon" aria-hidden="true">
                      {hasActiveOpFilters ? '🔍' : '📅'}
                    </div>
                    <div className="table-state-title">
                      {hasActiveOpFilters ? 'No Matching Employees Found' : 'No Eligible Employees Found'}
                    </div>
                    <div className="table-state-description">
                      {hasActiveOpFilters
                        ? 'No employee attendance records match your filter criteria for this date.'
                        : 'No employees are registered or eligible in this scope.'}
                    </div>
                    {hasActiveOpFilters && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: '0.75rem' }}
                        onClick={handleClearOpFilters}
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="table-card attendance-table-card">
                  <div className="table-responsive">
                    <table
                      className="mbiotrack-table attendance-table"
                      role="table"
                      aria-label="Daily employee attendance operations"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Employee</th>
                          <th scope="col">Assigned Office</th>
                          <th scope="col">Punch Count</th>
                          <th scope="col">First Punch</th>
                          <th scope="col">Last Punch</th>
                          <th scope="col">Roaming Status</th>
                          <th scope="col">Review Status</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opData.employees.map((emp) => (
                          <tr key={emp.employee_id} data-testid={`row-emp-${emp.employee_code}`}>
                            {/* Employee Info */}
                            <td className="attendance-cell-employee">
                              <div className="employee-cell-primary">
                                <span className="employee-name-text">{emp.employee_name}</span>
                                <span className="employee-code-badge" style={{ marginLeft: '0.35rem' }}>
                                  {emp.employee_code}
                                </span>
                              </div>
                              {emp.department && (
                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  {emp.department}
                                </div>
                              )}
                            </td>

                            {/* Assigned Office */}
                            <td className="attendance-cell-office">
                              {emp.assigned_office_name ? (
                                <div>
                                  <span>{emp.assigned_office_name}</span>
                                  {emp.assigned_office_code && (
                                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                      Code: {emp.assigned_office_code}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted">Unassigned</span>
                              )}
                            </td>

                            {/* Punch Count */}
                            <td className="attendance-cell-count">
                              <strong>{emp.punch_count}</strong> {emp.punch_count === 1 ? 'punch' : 'punches'}
                            </td>

                            {/* First Punch */}
                            <td className="attendance-cell-time">{formatTimeOnly(emp.first_punch)}</td>

                            {/* Last Punch */}
                            <td className="attendance-cell-time">{formatTimeOnly(emp.last_punch)}</td>

                            {/* Roaming Status */}
                            <td className="attendance-cell-roaming">
                              {emp.has_roaming ? (
                                <span
                                  className="roaming-badge badge-roaming"
                                  data-testid="daily-roaming-badge"
                                  title={`${emp.roaming_count} roaming punch(es) recorded outside assigned office`}
                                >
                                  ⚠️ Roaming ({emp.roaming_count})
                                </span>
                              ) : emp.punch_count > 0 ? (
                                <span
                                  className="roaming-badge badge-assigned"
                                  data-testid="daily-assigned-badge"
                                  title="All recorded punches match assigned office"
                                >
                                  ✓ In-Assignment
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>

                            {/* Review Status */}
                            <td className="attendance-cell-status">
                              {emp.review_status === 'NO_PUNCH' ? (
                                <span className="audit-badge badge-neutral" data-testid="status-no-punch">
                                  No punch recorded
                                </span>
                              ) : emp.review_status === 'REQUIRES_REVIEW' ? (
                                <span
                                  className="audit-badge badge-warning"
                                  data-testid="status-requires-review"
                                  title={emp.review_reason || 'Requires operational review'}
                                >
                                  Requires Review
                                </span>
                              ) : (
                                <span className="audit-badge badge-create" data-testid="status-normal">
                                  Normal
                                </span>
                              )}
                            </td>

                            {/* Actions / Inspect */}
                            <td className="attendance-cell-actions">
                              {emp.punches && emp.punches.length > 0 && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setInspectingEmployee(emp)}
                                  aria-label={`Inspect punches for ${emp.employee_name}`}
                                >
                                  Inspect Punches
                                </button>
                              )}
                              {emp.review_status === 'REQUIRES_REVIEW' && (
                                <button
                                  type="button"
                                  className="btn btn-outline-primary btn-sm"
                                  style={{ marginLeft: '0.25rem' }}
                                  onClick={() => {
                                    setCorrectionTarget({
                                      employeeId: emp.employee_id,
                                      employeeName: emp.employee_name,
                                      employeeCode: emp.employee_code,
                                      date: opData?.summary.date || getTodayUtc(),
                                      type: emp.review_reason?.includes('Missing CHECK_IN')
                                        ? 'MISSING_CHECK_IN'
                                        : 'MISSING_CHECK_OUT',
                                      punches: emp.punches,
                                    });
                                    setIsCorrectionModalOpen(true);
                                  }}
                                  aria-label={`Request correction for ${emp.employee_name}`}
                                >
                                  Correct
                                </button>
                              )}
                              {(!emp.punches || emp.punches.length === 0) && emp.review_status !== 'REQUIRES_REVIEW' && (
                                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  No punches
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="table-footer attendance-pagination-footer">
                    <div className="pagination-info">
                      Showing{' '}
                      <strong>{opData.total_employees === 0 ? 0 : opOffset + 1}</strong> to{' '}
                      <strong>{Math.min(opOffset + PAGE_SIZE, opData.total_employees)}</strong> of{' '}
                      <strong>{opData.total_employees}</strong> employees
                    </div>
                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setOpOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                        disabled={opOffset === 0 || isOpLoading}
                        aria-label="Previous page of employees"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setOpOffset((prev) => prev + PAGE_SIZE)}
                        disabled={opOffset + PAGE_SIZE >= opData.total_employees || isOpLoading}
                        aria-label="Next page of employees"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Roaming & Punch Inspection Modal */}
          {inspectingEmployee && (
            <div
              className="modal-overlay"
              role="presentation"
              onClick={() => setInspectingEmployee(null)}
            >
              <div
                className="modal-dialog inspect-punches-modal-container"
                role="dialog"
                aria-modal="true"
                aria-labelledby="inspect-punches-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <h3 id="inspect-punches-title" style={{ margin: 0 }}>
                      Punch Details: {inspectingEmployee.employee_name}
                    </h3>
                    <div className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                      Code: <strong>{inspectingEmployee.employee_code}</strong> | Assigned Office:{' '}
                      <strong>{inspectingEmployee.assigned_office_name || 'Unassigned'}</strong> | Date:{' '}
                      <strong>{opData?.summary.date}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setInspectingEmployee(null)}
                    aria-label="Close punch inspection modal"
                  >
                    ×
                  </button>
                </div>

                <div className="modal-body" style={{ padding: '1.25rem' }}>
                  {inspectingEmployee.has_roaming && (
                    <div className="roaming-alert-box" role="alert">
                      <span aria-hidden="true">⚠️</span>
                      <div>
                        <strong>Roaming Activity Detected (GOV-08):</strong>
                        <div>
                          One or more punches were recorded at a terminal location that does not match this
                          employee's active office assignment. Review recorded punch details below.
                        </div>
                      </div>
                    </div>
                  )}

                  <table
                    className="mbiotrack-table inspection-table"
                    role="table"
                    aria-label="Granular punch list"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Type</th>
                        <th scope="col">Office</th>
                        <th scope="col">Device</th>
                        <th scope="col">Assignment Status</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectingEmployee.punches.map((p) => (
                        <tr key={p.id}>
                          <td className="attendance-cell-time">
                            <strong>{formatTimeOnly(p.event_timestamp)}</strong>
                          </td>
                          <td>
                            <span
                              className={`audit-badge ${
                                p.punch_type === 'CHECK_IN' ? 'badge-create' : 'badge-update'
                              }`}
                            >
                              {p.punch_type}
                            </span>
                            {p.is_corrected && (
                              <span
                                className="badge badge-info"
                                style={{
                                  marginLeft: '0.5rem',
                                  fontSize: '0.75rem',
                                  backgroundColor: '#e0f2fe',
                                  color: '#0369a1',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '4px',
                                  fontWeight: 600,
                                }}
                                title="Manually corrected punch"
                              >
                                Corrected
                              </span>
                            )}
                          </td>
                          <td>{p.office_name || `Office #${p.office_id}`}</td>
                          <td>{p.device_name || `Device #${p.device_id}`}</td>
                          <td>
                            {p.is_roaming ? (
                              <span
                                className="roaming-badge badge-roaming"
                                title="Out-of-assignment roaming punch under GOV-08"
                              >
                                ⚠️ Roaming (GOV-08)
                              </span>
                            ) : (
                              <span
                                className="roaming-badge badge-assigned"
                                title="Matches assigned office"
                              >
                                ✓ In-Assignment
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => {
                                setCorrectionTarget({
                                  employeeId: inspectingEmployee.employee_id,
                                  employeeName: inspectingEmployee.employee_name,
                                  employeeCode: inspectingEmployee.employee_code,
                                  date: opData?.summary.date || getTodayUtc(),
                                  type: 'TIMESTAMP_ADJUSTMENT',
                                  originalEventId: p.id,
                                  punches: inspectingEmployee.punches,
                                });
                                setInspectingEmployee(null);
                                setIsCorrectionModalOpen(true);
                              }}
                              aria-label={`Adjust ${p.punch_type} punch at ${formatTimeOnly(p.event_timestamp)}`}
                            >
                              Adjust
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div
                    className="text-muted"
                    style={{ fontSize: '0.75rem', marginTop: '1rem', fontStyle: 'italic' }}
                  >
                    Inspection mode only. Roaming punches are logged under GOV-08 and are not automatically
                    approved, rejected, or modified here.
                  </div>
                </div>

                <div className="modal-footer" style={{ padding: '0.875rem 1.25rem', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => {
                      let initialType: AttendanceCorrectionType = 'TIMESTAMP_ADJUSTMENT';
                      let defaultEventId: number | null = null;
                      if (inspectingEmployee.review_reason?.includes('Missing CHECK_IN')) {
                        initialType = 'MISSING_CHECK_IN';
                      } else if (inspectingEmployee.review_reason?.includes('Missing CHECK_OUT')) {
                        initialType = 'MISSING_CHECK_OUT';
                      } else if (inspectingEmployee.punches && inspectingEmployee.punches.length > 0) {
                        initialType = 'TIMESTAMP_ADJUSTMENT';
                        defaultEventId = inspectingEmployee.punches[inspectingEmployee.punches.length - 1].id;
                      } else {
                        initialType = 'MISSING_CHECK_OUT';
                      }

                      setCorrectionTarget({
                        employeeId: inspectingEmployee.employee_id,
                        employeeName: inspectingEmployee.employee_name,
                        employeeCode: inspectingEmployee.employee_code,
                        date: opData?.summary.date || getTodayUtc(),
                        type: initialType,
                        originalEventId: defaultEventId,
                        punches: inspectingEmployee.punches,
                      });
                      setInspectingEmployee(null);
                      setIsCorrectionModalOpen(true);
                    }}
                  >
                    Request Correction
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setInspectingEmployee(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          TAB 2: ATTENDANCE REPORTS & CSV EXPORT (SLICE 8)
          ===================================================================== */}
      {activeTab === 'reports' && (
        <section aria-labelledby="reports-heading">
          {/* Header */}
          <div className="dashboard-header-section">
            <div className="dashboard-heading">
              <h2 id="reports-heading">{reportTitle}</h2>
              <p>{reportSubtitle}</p>
            </div>
            <div className="dashboard-actions-group">
              {onNavigateToDirectory && !isEmployee && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onNavigateToDirectory}
                  title="Return to Employee Directory"
                >
                  ← Back to Directory
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsReportLoading(true);
                  setReportError(null);
                  setReportReloadTrigger((prev) => prev + 1);
                }}
                disabled={isReportLoading}
                title="Refresh attendance report"
              >
                🔄 Refresh
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExportCsv}
                disabled={isReportLoading || isExportingCsv}
                title="Export report to CSV"
                data-testid="export-csv-btn"
              >
                {isExportingCsv ? '⏳ Exporting...' : '📥 Export CSV'}
              </button>
            </div>
          </div>

          {/* Filter Toolbar */}
          <section className="toolbar-card attendance-filter-card" aria-label="Attendance report filters">
            <form className="attendance-filter-form" onSubmit={handleApplyReportFilters}>
              <div className="attendance-filter-grid">
                {/* Start Date */}
                <div className="filter-field">
                  <label htmlFor="filter-report-start-date" className="filter-label">
                    Start Date
                  </label>
                  <input
                    id="filter-report-start-date"
                    type="date"
                    className="filter-input"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                    aria-label="Filter by report start date"
                    required
                  />
                </div>

                {/* End Date */}
                <div className="filter-field">
                  <label htmlFor="filter-report-end-date" className="filter-label">
                    End Date
                  </label>
                  <input
                    id="filter-report-end-date"
                    type="date"
                    className="filter-input"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    aria-label="Filter by report end date"
                    required
                  />
                </div>

                {/* Office Filter */}
                <div className="filter-field">
                  <label htmlFor="filter-report-office" className="filter-label">
                    Office Filter
                  </label>
                  {officesList.length > 0 ? (
                    <select
                      id="filter-report-office"
                      className="filter-select"
                      value={reportOfficeId}
                      onChange={(e) => setReportOfficeId(e.target.value)}
                      aria-label="Filter by office"
                    >
                      <option value="">All Offices</option>
                      {officesList.map((off) => (
                        <option key={off.id} value={off.id}>
                          {off.name} ({off.code})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="filter-report-office"
                      type="number"
                      min="1"
                      className="filter-input"
                      placeholder="e.g. 1"
                      value={reportOfficeId}
                      onChange={(e) => setReportOfficeId(e.target.value)}
                      aria-label="Filter by office ID"
                    />
                  )}
                </div>

                {/* Employee Filter (Admin/Manager only) */}
                {!isEmployee && (
                  <div className="filter-field">
                    <label htmlFor="filter-report-employee" className="filter-label">
                      Employee ID
                    </label>
                    <input
                      id="filter-report-employee"
                      type="number"
                      min="1"
                      className="filter-input"
                      placeholder="e.g. 101"
                      value={reportEmployeeId}
                      onChange={(e) => setReportEmployeeId(e.target.value)}
                      aria-label="Filter by employee ID"
                    />
                  </div>
                )}

                {/* Department Filter (Admin can filter, Manager sees read-only, Employee hidden) */}
                {isAdmin && (
                  <div className="filter-field">
                    <label htmlFor="filter-report-department" className="filter-label">
                      Department
                    </label>
                    <input
                      id="filter-report-department"
                      type="text"
                      className="filter-input"
                      placeholder="e.g. Engineering"
                      value={reportDepartment}
                      onChange={(e) => setReportDepartment(e.target.value)}
                      aria-label="Filter by department"
                      data-testid="filter-report-department"
                    />
                  </div>
                )}
                {isManager && (
                  <div className="filter-field">
                    <label htmlFor="filter-report-department-locked" className="filter-label">
                      Department
                    </label>
                    <input
                      id="filter-report-department-locked"
                      type="text"
                      className="filter-input"
                      value={managerDepartment || 'Assigned Department'}
                      disabled
                      readOnly
                      aria-label="Authorized department"
                      title="Manager report is restricted to your authorized team department"
                      data-testid="filter-report-department-locked"
                    />
                  </div>
                )}
              </div>

              <div className="attendance-filter-actions">
                <button type="submit" className="btn btn-primary" disabled={isReportLoading}>
                  Generate Report
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportCsv}
                  disabled={isReportLoading || isExportingCsv}
                  title="Export current report as CSV"
                >
                  {isExportingCsv ? '⏳ Exporting...' : '📥 Export CSV'}
                </button>
                {hasActiveReportFilters && (
                  <button
                    type="button"
                    className="btn-clear-filters"
                    onClick={handleClearReportFilters}
                    disabled={isReportLoading}
                  >
                    Reset Filters
                  </button>
                )}
                <span className="text-muted" style={{ fontSize: '0.8125rem', marginLeft: 'auto' }}>
                  ℹ️ Maximum date range: 31 days.
                </span>
              </div>
            </form>
          </section>

          {/* Validation Warning Banner */}
          {validationWarning && (
            <div className="alert-banner warning" role="alert" style={{ marginBottom: '1.25rem' }}>
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{validationWarning}</span>
              </div>
            </div>
          )}

          {/* Export Error Banner */}
          {exportError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '1.25rem' }}>
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{exportError}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setExportError(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Report Error Banner */}
          {reportError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '1.25rem' }}>
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{reportError}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setIsReportLoading(true);
                  setReportError(null);
                  setReportReloadTrigger((prev) => prev + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {isReportLoading ? (
            <div className="table-card" aria-busy="true" aria-live="polite">
              <div className="table-state-container">
                <div className="table-spinner" role="progressbar" aria-label="Loading attendance report" />
                <div className="table-state-title">Generating Attendance Report...</div>
                <div className="table-state-description">Compiling date-range metrics and punch records</div>
              </div>
            </div>
          ) : !reportData ? (
            <div className="table-card" role="region" aria-label="No data">
              <div className="table-state-container">
                <div className="table-state-icon" aria-hidden="true">📊</div>
                <div className="table-state-title">Unable to Display Report</div>
                <div className="table-state-description">Please verify your connection and retry.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Cards Grid */}
              <div className="attendance-summary-grid" role="region" aria-label="Attendance report summary cards">
                {/* 1. Total Recorded Punch Events */}
                <div className="attendance-summary-card" data-testid="card-report-total-events">
                  <div className="attendance-summary-icon events" aria-hidden="true">
                    ⚡
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{reportData.summary.total_events}</span>
                    <span className="attendance-summary-label">Total Events</span>
                  </div>
                </div>

                {/* 2. Employees With Recorded Punches */}
                <div className="attendance-summary-card" data-testid="card-report-employees-with-punches">
                  <div className="attendance-summary-icon punches" aria-hidden="true">
                    👥
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{reportData.summary.employees_with_punches}</span>
                    <span className="attendance-summary-label">With Punches</span>
                  </div>
                </div>

                {/* 3. Employees With No Recorded Punches (Neutral Label) */}
                <div className="attendance-summary-card" data-testid="card-report-employees-without-punches">
                  <div className="attendance-summary-icon nopunch" aria-hidden="true">
                    ⏳
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{reportData.summary.employees_without_punches}</span>
                    <span className="attendance-summary-label">No Punch Recorded</span>
                  </div>
                </div>

                {/* 4. Roaming Punch Count */}
                <div
                  className={`attendance-summary-card ${
                    reportData.summary.roaming_punch_count > 0 ? 'highlight-roaming' : ''
                  }`}
                  data-testid="card-report-roaming-punches"
                >
                  <div className="attendance-summary-icon roaming" aria-hidden="true">
                    🌐
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">{reportData.summary.roaming_punch_count}</span>
                    <span className="attendance-summary-label">Roaming Punches</span>
                  </div>
                </div>

                {/* 5. Date Range */}
                <div className="attendance-summary-card" data-testid="card-report-date-range">
                  <div className="attendance-summary-icon" aria-hidden="true">
                    📅
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value" style={{ fontSize: '1rem', whiteSpace: 'nowrap' }}>
                      {reportData.summary.start_date} to {reportData.summary.end_date}
                    </span>
                    <span className="attendance-summary-label">Report Range</span>
                  </div>
                </div>

                {/* 6. Total Worked Hours */}
                <div className="attendance-summary-card" data-testid="card-report-total-hours">
                  <div className="attendance-summary-icon" aria-hidden="true">
                    ⏱️
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">
                      {reportData.summary.total_worked_hours !== undefined
                        ? `${reportData.summary.total_worked_hours}h`
                        : '0h'}
                    </span>
                    <span className="attendance-summary-label">Total Worked Hours</span>
                  </div>
                </div>

                {/* 7. Average Daily Worked Hours */}
                <div className="attendance-summary-card" data-testid="card-report-average-hours">
                  <div className="attendance-summary-icon" aria-hidden="true">
                    📊
                  </div>
                  <div className="attendance-summary-content">
                    <span className="attendance-summary-value">
                      {reportData.summary.average_daily_worked_hours !== undefined &&
                      reportData.summary.average_daily_worked_hours !== null
                        ? `${reportData.summary.average_daily_worked_hours}h`
                        : '—'}
                    </span>
                    <span className="attendance-summary-label">Avg Daily Hours</span>
                  </div>
                </div>
              </div>

              {/* Report Table */}
              {reportData.items.length === 0 ? (
                <div className="table-card" role="region" aria-label="Empty attendance report">
                  <div className="table-state-container">
                    <div className="table-state-icon" aria-hidden="true">
                      {hasActiveReportFilters ? '🔍' : '📊'}
                    </div>
                    <div className="table-state-title">
                      {hasActiveReportFilters ? 'No Matching Records Found' : 'No Report Records Found'}
                    </div>
                    <div className="table-state-description">
                      {hasActiveReportFilters
                        ? 'No attendance records match your filter criteria for this date range.'
                        : 'No attendance records exist for the selected date range.'}
                    </div>
                    {hasActiveReportFilters && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: '0.75rem' }}
                        onClick={handleClearReportFilters}
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="table-card attendance-table-card">
                  <div className="table-responsive" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table
                      className="mbiotrack-table attendance-table"
                      role="table"
                      aria-label="Attendance report records"
                      style={{ width: '100%', minWidth: '1220px', tableLayout: 'auto' }}
                    >
                      <thead>
                        <tr>
                          <th scope="col" style={{ minWidth: '110px', width: '110px', whiteSpace: 'nowrap' }}>Date</th>
                          <th scope="col" style={{ minWidth: '220px', whiteSpace: 'nowrap' }}>Employee</th>
                          <th scope="col" style={{ minWidth: '170px', whiteSpace: 'nowrap' }}>Office</th>
                          <th scope="col" style={{ minWidth: '120px', width: '120px', textAlign: 'center', whiteSpace: 'nowrap' }}>Punch Count</th>
                          <th scope="col" style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}>First Punch</th>
                          <th scope="col" style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}>Last Punch</th>
                          <th scope="col" style={{ minWidth: '130px', width: '130px', whiteSpace: 'nowrap' }}>Work Duration</th>
                          <th scope="col" style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}>Roaming Status</th>
                          <th scope="col" style={{ minWidth: '170px', width: '170px', whiteSpace: 'nowrap' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.items.map((item, idx) => (
                          <tr
                            key={`${item.employee_id}-${item.attendance_date}-${idx}`}
                            data-testid={`report-row-${item.employee_code}-${item.attendance_date}`}
                          >
                            {/* Attendance Date */}
                            <td className="attendance-cell-date" style={{ minWidth: '110px', width: '110px', whiteSpace: 'nowrap', fontWeight: 500 }}>
                              {item.attendance_date}
                            </td>

                            {/* Employee */}
                            <td className="attendance-cell-employee" style={{ minWidth: '220px' }}>
                              <div
                                className="employee-cell-primary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
                              >
                                <span className="employee-name-text" style={{ fontWeight: 600 }}>{item.employee_name}</span>
                                <span className="employee-code-badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {item.employee_code}
                                </span>
                              </div>
                              {item.department && (
                                <div className="text-muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', marginTop: '0.15rem' }}>
                                  {item.department}
                                </div>
                              )}
                            </td>

                            {/* Office */}
                            <td className="attendance-cell-office" style={{ minWidth: '170px' }}>
                              {item.office_name ? (
                                <div>
                                  <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{item.office_name}</div>
                                  {item.office_code && (
                                    <div className="text-muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', marginTop: '0.15rem' }}>
                                      Code: {item.office_code}
                                    </div>
                                  )}
                                </div>
                              ) : item.office_id ? (
                                <span style={{ whiteSpace: 'nowrap' }}>Office #{item.office_id}</span>
                              ) : (
                                <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>—</span>
                              )}
                            </td>

                            {/* Punch Count */}
                            <td
                              className="attendance-cell-count"
                              style={{ minWidth: '120px', width: '120px', textAlign: 'center', whiteSpace: 'nowrap' }}
                            >
                              <span
                                className={`punch-count-pill ${
                                   item.punch_count === 0 ? 'count-zero' : 'count-positive'
                                }`}
                                style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                              >
                                {item.punch_count}
                              </span>
                            </td>

                            {/* First Punch */}
                            <td className="attendance-cell-time" style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}>
                              {formatTimestamp(item.first_punch)}
                            </td>

                            {/* Last Punch */}
                            <td className="attendance-cell-time" style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}>
                              {formatTimestamp(item.last_punch)}
                            </td>

                            {/* Work Duration */}
                            <td
                              className="attendance-cell-duration"
                              data-testid="cell-report-duration"
                              style={{ minWidth: '130px', width: '130px', whiteSpace: 'nowrap' }}
                            >
                              {item.work_duration_formatted ? (
                                <span
                                  className="duration-pill"
                                  style={{ fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-block' }}
                                >
                                  {item.work_duration_formatted}
                                </span>
                              ) : (
                                <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>—</span>
                              )}
                            </td>

                            {/* Roaming Status */}
                            <td
                              className="attendance-cell-roaming"
                              style={{ minWidth: '160px', width: '160px', whiteSpace: 'nowrap' }}
                            >
                              {item.has_roaming ? (
                                <span
                                  className="roaming-badge badge-roaming"
                                  style={{ whiteSpace: 'nowrap', display: 'inline-block' }}
                                  title="Includes roaming punches outside assigned office"
                                >
                                  ⚠️ Roaming ({item.roaming_count})
                                </span>
                              ) : item.status === 'NO_PUNCH' ? (
                                <span className="text-muted" style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                  No punch recorded
                                </span>
                              ) : (
                                <span
                                  className="roaming-badge badge-assigned"
                                  style={{ whiteSpace: 'nowrap', display: 'inline-block' }}
                                  title="Terminal matches employee active office assignment"
                                >
                                  ✓ In-Assignment
                                </span>
                              )}
                            </td>

                            {/* Status */}
                            <td
                              className="attendance-cell-status"
                              style={{ minWidth: '170px', width: '170px', whiteSpace: 'nowrap' }}
                            >
                              {item.status === 'NO_PUNCH' ? (
                                <span className="review-status-badge status-nopunch" style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
                                  ⏳ No Punch Recorded
                                </span>
                              ) : item.status === 'REQUIRES_REVIEW' ? (
                                <span className="review-status-badge status-review" style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
                                  ⚠️ Requires Review
                                </span>
                              ) : (
                                <span className="review-status-badge status-normal" style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
                                  ✓ Normal
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="table-footer attendance-pagination-footer">
                    <div className="pagination-info">
                      Showing <strong>{reportData.total_items === 0 ? 0 : reportOffset + 1}</strong> to{' '}
                      <strong>{Math.min(reportOffset + PAGE_SIZE, reportData.total_items)}</strong> of{' '}
                      <strong>{reportData.total_items}</strong> records
                    </div>
                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReportOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                        disabled={reportOffset === 0 || isReportLoading}
                        aria-label="Previous page of report records"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReportOffset((prev) => prev + PAGE_SIZE)}
                        disabled={reportOffset + PAGE_SIZE >= reportData.total_items || isReportLoading}
                        aria-label="Next page of report records"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* =====================================================================
          TAB 3: EVENT FEED (RAW PUNCH LOG - SLICE 5)
          ===================================================================== */}
      {activeTab === 'events' && (
        <section aria-labelledby="event-feed-heading">
          {/* Header */}
          <div className="dashboard-header-section">
            <div className="dashboard-heading">
              <h2 id="event-feed-heading">{eventTitle}</h2>
              <p>{eventSubtitle}</p>
            </div>
            <div className="dashboard-actions-group">
              {onNavigateToDirectory && !isEmployee && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onNavigateToDirectory}
                  title="Return to Employee Directory"
                >
                  ← Back to Directory
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsEventLoading(true);
                  setEventError(null);
                  setEventReloadTrigger((prev) => prev + 1);
                }}
                disabled={isEventLoading}
                title="Refresh attendance records"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* Filter Toolbar */}
          <section className="toolbar-card attendance-filter-card" aria-label="Attendance filters">
            <form className="attendance-filter-form" onSubmit={handleApplyEventFilters}>
              <div className="attendance-filter-grid">
                {/* Employee ID filter (Admin and Manager only) */}
                {!isEmployee && (
                  <div className="filter-field">
                    <label htmlFor="filter-employee-id" className="filter-label">
                      Employee ID
                    </label>
                    <input
                      id="filter-employee-id"
                      type="number"
                      min="1"
                      className="filter-input"
                      placeholder="e.g. 101"
                      value={employeeIdFilter}
                      onChange={(e) => setEmployeeIdFilter(e.target.value)}
                      aria-label="Filter by employee ID"
                    />
                  </div>
                )}

                {/* Office ID filter */}
                <div className="filter-field">
                  <label htmlFor="filter-office-id" className="filter-label">
                    Office ID
                  </label>
                  <input
                    id="filter-office-id"
                    type="number"
                    min="1"
                    className="filter-input"
                    placeholder="e.g. 1"
                    value={officeIdFilter}
                    onChange={(e) => setOfficeIdFilter(e.target.value)}
                    aria-label="Filter by office ID"
                  />
                </div>

                {/* Punch Type filter */}
                <div className="filter-field">
                  <label htmlFor="filter-punch-type" className="filter-label">
                    Punch Type
                  </label>
                  <select
                    id="filter-punch-type"
                    className="filter-select"
                    value={punchTypeFilter}
                    onChange={(e) => setPunchTypeFilter(e.target.value)}
                    aria-label="Filter by punch type"
                  >
                    <option value="ALL">All Punch Types</option>
                    <option value="CHECK_IN">Check In (CHECK_IN)</option>
                    <option value="CHECK_OUT">Check Out (CHECK_OUT)</option>
                  </select>
                </div>

                {/* Roaming Status filter */}
                <div className="filter-field">
                  <label htmlFor="filter-roaming-status" className="filter-label">
                    Roaming Status (GOV-08)
                  </label>
                  <select
                    id="filter-roaming-status"
                    className="filter-select"
                    value={roamingFilter}
                    onChange={(e) => setRoamingFilter(e.target.value)}
                    aria-label="Filter by roaming status"
                  >
                    <option value="ALL">All Roaming Statuses</option>
                    <option value="ASSIGNED">In-Assignment Only</option>
                    <option value="ROAMING">Roaming Only (GOV-08)</option>
                  </select>
                </div>

                {/* Start Date filter */}
                <div className="filter-field">
                  <label htmlFor="filter-start-date" className="filter-label">
                    Start Date
                  </label>
                  <input
                    id="filter-start-date"
                    type="date"
                    className="filter-input"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    aria-label="Filter start date"
                  />
                </div>

                {/* End Date filter */}
                <div className="filter-field">
                  <label htmlFor="filter-end-date" className="filter-label">
                    End Date
                  </label>
                  <input
                    id="filter-end-date"
                    type="date"
                    className="filter-input"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    aria-label="Filter end date"
                  />
                </div>
              </div>

              <div className="attendance-filter-actions">
                <button type="submit" className="btn btn-primary" disabled={isEventLoading}>
                  Apply Filters
                </button>
                {hasActiveEventFilters && (
                  <button
                    type="button"
                    className="btn-clear-filters"
                    onClick={handleClearEventFilters}
                    disabled={isEventLoading}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* Error Banner */}
          {eventError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: '1.25rem' }}>
              <div className="alert-content">
                <span aria-hidden="true">⚠️</span>
                <span>{eventError}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setIsEventLoading(true);
                  setEventError(null);
                  setEventReloadTrigger((prev) => prev + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {isEventLoading ? (
            <div className="table-card" aria-busy="true" aria-live="polite">
              <div className="table-state-container">
                <div className="table-spinner" role="progressbar" aria-label="Loading attendance records" />
                <div className="table-state-title">Loading Attendance Records...</div>
                <div className="table-state-description">Retrieving normalized terminal punch telemetry</div>
              </div>
            </div>
          ) : records.length === 0 ? (
            <div className="table-card" role="region" aria-label="Empty attendance records">
              <div className="table-state-container">
                <div className="table-state-icon" aria-hidden="true">
                  {hasActiveEventFilters ? '🔍' : '📅'}
                </div>
                <div className="table-state-title">
                  {hasActiveEventFilters ? 'No Matching Records Found' : 'No Attendance Records Found'}
                </div>
                <div className="table-state-description">
                  {hasActiveEventFilters
                    ? 'No attendance records match the selected filters. Try clearing or expanding your criteria.'
                    : isEmployee
                      ? 'No attendance punches recorded for your profile yet.'
                      : 'No attendance punch events have been recorded in the system.'}
                </div>
                {hasActiveEventFilters && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: '0.75rem' }}
                    onClick={handleClearEventFilters}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="table-card attendance-table-card">
              <div className="table-responsive">
                <table className="mbiotrack-table attendance-table" role="table" aria-label="Attendance events list">
                  <thead>
                    <tr>
                      <th scope="col">Timestamp</th>
                      {!isEmployee && <th scope="col">Employee</th>}
                      <th scope="col">Office</th>
                      <th scope="col">Device</th>
                      <th scope="col">Punch Type</th>
                      <th scope="col">Assignment Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec) => (
                      <tr key={rec.id}>
                        {/* Timestamp */}
                        <td className="attendance-cell-time">
                          <strong>{formatTimestamp(rec.event_timestamp)}</strong>
                        </td>

                        {/* Employee (for Manager / Admin) */}
                        {!isEmployee && (
                          <td className="attendance-cell-employee">
                            <div className="employee-cell-primary">
                              <span className="employee-name-text">
                                {rec.employee_name || `Employee #${rec.employee_id}`}
                              </span>
                              {rec.employee_code && (
                                <span className="employee-code-badge" style={{ marginLeft: '0.35rem' }}>
                                  {rec.employee_code}
                                </span>
                              )}
                            </div>
                            {rec.department && (
                              <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                {rec.department}
                              </div>
                            )}
                          </td>
                        )}

                        {/* Office */}
                        <td className="attendance-cell-office">
                          <span>{rec.office_name || `Office #${rec.office_id}`}</span>
                          {rec.office_code && (
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                              Code: {rec.office_code}
                            </div>
                          )}
                        </td>

                        {/* Device */}
                        <td className="attendance-cell-device">
                          <span>{rec.device_name || `Device #${rec.device_id}`}</span>
                          {rec.device_code && (
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                              Code: {rec.device_code}
                            </div>
                          )}
                        </td>

                        {/* Punch Type */}
                        <td className="attendance-cell-punch">
                          <span
                            className={`audit-badge ${
                              rec.punch_type === 'CHECK_IN' ? 'badge-create' : 'badge-update'
                            }`}
                          >
                            {rec.punch_type === 'CHECK_IN' ? 'IN' : 'OUT'} — {rec.punch_type}
                          </span>
                        </td>

                        {/* Roaming Status (GOV-08) */}
                        <td className="attendance-cell-roaming">
                          {rec.is_roaming ? (
                            <span
                              className="roaming-badge badge-roaming"
                              data-testid="roaming-badge"
                              title="Out-of-assignment roaming punch permitted under GOV-08"
                            >
                              ⚠️ Roaming (GOV-08)
                            </span>
                          ) : (
                            <span
                              className="roaming-badge badge-assigned"
                              data-testid="assigned-badge"
                              title="Terminal matches employee active office assignment"
                            >
                              ✓ In-Assignment
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              <div className="table-footer attendance-pagination-footer">
                <div className="pagination-info">
                  Showing <strong>{total === 0 ? 0 : eventOffset + 1}</strong> to{' '}
                  <strong>{Math.min(eventOffset + PAGE_SIZE, total)}</strong> of{' '}
                  <strong>{total}</strong> attendance records
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEventOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                    disabled={eventOffset === 0 || isEventLoading}
                    aria-label="Previous page of attendance records"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEventOffset((prev) => prev + PAGE_SIZE)}
                    disabled={eventOffset + PAGE_SIZE >= total || isEventLoading}
                    aria-label="Next page of attendance records"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Attendance Punch Confirmation Modal */}
      <PunchModal
        isOpen={isPunchModalOpen}
        currentUser={currentUser}
        defaultPunchType={punchModalDefaultType}
        targetEmployeeId={punchTargetEmployee?.id}
        targetEmployeeName={punchTargetEmployee?.name}
        isSubmitting={isPunchSubmitting}
        serverError={punchServerError}
        onClose={() => {
          if (!isPunchSubmitting) {
            setIsPunchModalOpen(false);
            setPunchServerError(null);
          }
        }}
        onSubmit={handlePunchSubmit}
      />

      {/* Attendance Correction Modal (Phase 2) */}
      {isCorrectionModalOpen && (
        <AttendanceCorrectionModal
          isOpen={isCorrectionModalOpen}
          currentUser={currentUser}
          targetEmployeeId={correctionTarget?.employeeId ?? currentUser.employee_id}
          targetEmployeeName={correctionTarget?.employeeName ?? currentUser.full_name}
          targetEmployeeCode={correctionTarget?.employeeCode}
          attendanceDate={correctionTarget?.date ?? opData?.summary.date}
          initialCorrectionType={correctionTarget?.type ?? 'TIMESTAMP_ADJUSTMENT'}
          initialOriginalEventId={correctionTarget?.originalEventId}
          availablePunches={correctionTarget?.punches ?? []}
          onClose={() => {
            setIsCorrectionModalOpen(false);
            setCorrectionTarget(null);
          }}
          onSuccess={(_corr) => {
            setPunchFeedback({
              type: 'success',
              message: 'Attendance correction request submitted successfully. It will be reviewed by management.',
            });
            setOpReloadTrigger((prev) => prev + 1);
          }}
        />
      )}
    </main>
  );
};
