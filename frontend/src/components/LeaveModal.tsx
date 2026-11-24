import React, { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/apiError';
import { getAssignments } from '../api/assignmentApi';
import { getHolidays } from '../api/holidayApi';
import { getOffices } from '../api/officeApi';
import { getEmployeeLeaveBalances } from '../api/leaveApi';
import type { User } from '../types/auth';
import type { OfficeAssignment } from '../types/assignment';
import type { HolidayDetail } from '../types/holiday';
import type {
  EmployeeLeaveBalanceSummary,
  LeaveRequestCreatePayload,
  LeaveType,
  LeaveTypeBalance,
} from '../types/leave';
import type { Office } from '../types/office';
import './components.css';

export interface LeaveModalProps {
  isOpen: boolean;
  currentUser: User;
  isSubmitting?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (payload: LeaveRequestCreatePayload) => void;
}

interface FormState {
  start_date: string;
  end_date: string;
  leave_type: LeaveType;
  reason: string;
  employee_id: string;
}

interface FormErrors {
  start_date?: string;
  end_date?: string;
  employee_id?: string;
  date_range?: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const getTodayUtc = () => new Date().toISOString().split('T')[0];

function getNextDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().split('T')[0];
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function getLocalNoonTimestamp(dateStr: string, timeZone = 'Asia/Kolkata'): number {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const utcGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(utcGuess);
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value;
    const tzYear = Number(getPart('year'));
    const tzMonth = Number(getPart('month'));
    const tzDay = Number(getPart('day'));
    const tzHour = Number(getPart('hour'));
    const tzMinute = Number(getPart('minute'));
    const tzSecond = Number(getPart('second'));
    const tzTimeAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);
    const offsetMs = tzTimeAsUtc - utcGuess.getTime();
    return Date.UTC(year, month - 1, day, 12, 0, 0) - offsetMs;
  } catch {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 12, 0, 0);
  }
}

function findEffectiveAssignment(
  currDateStr: string,
  assignments: OfficeAssignment[],
  officesMap: Map<number, Office>
): OfficeAssignment | null {
  for (const asgn of assignments) {
    if (!asgn.valid_from || !asgn.valid_to) continue;
    const office = officesMap.get(asgn.office_id);
    const timeZone = office?.timezone || 'Asia/Kolkata';
    const localNoonMs = getLocalNoonTimestamp(currDateStr, timeZone);
    const validFromMs = new Date(asgn.valid_from).getTime();
    const validToMs = new Date(asgn.valid_to).getTime();

    if (validFromMs <= localNoonMs && localNoonMs < validToMs) {
      return asgn;
    }
  }
  return null;
}

function calculateWorkingDays(
  startDateStr: string,
  endDateStr: string,
  allHolidays: HolidayDetail[],
  selectedOptionalDatesSet: Set<string>,
  assignments: OfficeAssignment[],
  officesMap: Map<number, Office>
): number {
  if (endDateStr < startDateStr) return 0;

  const holidaysByDate = new Map<string, HolidayDetail[]>();
  for (const h of allHolidays) {
    const list = holidaysByDate.get(h.holiday_date) || [];
    list.push(h);
    holidaysByDate.set(h.holiday_date, list);
  }

  let workingDays = 0;
  let curr = startDateStr;

  while (curr <= endDateStr) {
    const dow = getDayOfWeek(curr);
    // Weekend exclusion (0 = Sun, 6 = Sat)
    if (dow === 0 || dow === 6) {
      curr = getNextDate(curr);
      continue;
    }

    const effectiveAsgn = findEffectiveAssignment(curr, assignments, officesMap);
    const effectiveOfficeId = effectiveAsgn ? effectiveAsgn.office_id : null;

    const dayHols = holidaysByDate.get(curr) || [];
    let isHolidayExcluded = false;

    for (const h of dayHols) {
      const isApplicable =
        h.office_id === null ||
        h.office_id === undefined ||
        (effectiveOfficeId !== null && h.office_id === effectiveOfficeId);

      if (!isApplicable) continue;

      if (!h.is_optional) {
        // Official holiday: always excluded
        isHolidayExcluded = true;
        break;
      } else {
        // Optional holiday: excluded only if explicitly selected
        if (selectedOptionalDatesSet.has(curr)) {
          isHolidayExcluded = true;
          break;
        }
      }
    }

    if (!isHolidayExcluded) {
      workingDays++;
    }

    curr = getNextDate(curr);
  }

  return workingDays;
}

export const LeaveModal: React.FC<LeaveModalProps> = ({
  isOpen,
  currentUser,
  isSubmitting = false,
  serverError = null,
  onClose,
  onSubmit,
}) => {
  const isEmployee = currentUser.role === 'EMPLOYEE';

  const [trackedOpen, setTrackedOpen] = useState(isOpen);
  const [formState, setFormState] = useState<FormState>(() => ({
    start_date: getTodayUtc(),
    end_date: getTodayUtc(),
    leave_type: 'ANNUAL',
    reason: '',
    employee_id: '',
  }));

  const [errors, setErrors] = useState<FormErrors>({});
  const [holidaysInRange, setHolidaysInRange] = useState<HolidayDetail[]>([]);
  const [assignments, setAssignments] = useState<OfficeAssignment[]>([]);
  const [officesMap, setOfficesMap] = useState<Map<number, Office>>(new Map());
  const [selectedOptionalHolidays, setSelectedOptionalHolidays] = useState<string[]>([]);
  const [isLoadingHolidays, setIsLoadingHolidays] = useState<boolean>(false);
  const [holidayFetchError, setHolidayFetchError] = useState<string | null>(null);
  const [assignmentWarning, setAssignmentWarning] = useState<string | null>(null);

  // Leave balance state
  const [debouncedEmployeeIdInput, setDebouncedEmployeeIdInput] = useState<string>(formState.employee_id);
  const [balancesSummary, setBalancesSummary] = useState<EmployeeLeaveBalanceSummary | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState<boolean>(false);
  const [balanceFetchError, setBalanceFetchError] = useState<string | null>(null);

  // Debounce employee ID typing to avoid redundant API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEmployeeIdInput(formState.employee_id);
    }, 400);
    return () => clearTimeout(timer);
  }, [formState.employee_id]);

  if (trackedOpen !== isOpen) {
    setTrackedOpen(isOpen);
    if (isOpen) {
      setFormState({
        start_date: getTodayUtc(),
        end_date: getTodayUtc(),
        leave_type: 'ANNUAL',
        reason: '',
        employee_id: '',
      });
      setErrors({});
      setHolidaysInRange([]);
      setAssignments([]);
      setOfficesMap(new Map());
      setSelectedOptionalHolidays([]);
      setIsLoadingHolidays(false);
      setHolidayFetchError(null);
      setAssignmentWarning(null);
      setBalancesSummary(null);
      setIsLoadingBalances(false);
      setBalanceFetchError(null);
      setDebouncedEmployeeIdInput('');
    }
  }

  const targetEmployeeId = useMemo(() => {
    if (isEmployee) {
      return currentUser.employee_id ?? null;
    }
    const trimmed = debouncedEmployeeIdInput.trim();
    if (!trimmed) {
      return currentUser.employee_id ?? null;
    }
    const parsed = parseInt(trimmed, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : null;
  }, [isEmployee, currentUser.employee_id, debouncedEmployeeIdInput]);

  const currentCalendarYear = CURRENT_YEAR;

  // Fetch leave balances for resolved target employee and current calendar year
  useEffect(() => {
    if (!isOpen || !targetEmployeeId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setBalancesSummary(null);
      // oxlint-disable-next-line react/set-state-in-effect
      setIsLoadingBalances(false);
      // oxlint-disable-next-line react/set-state-in-effect
      setBalanceFetchError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingBalances(true);
    setBalanceFetchError(null);

    getEmployeeLeaveBalances(targetEmployeeId, currentCalendarYear)
      .then((data) => {
        if (!isMounted) return;
        setBalancesSummary(data);
        setIsLoadingBalances(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setBalancesSummary(null);
        setIsLoadingBalances(false);
        setBalanceFetchError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Failed to load employee leave balance.'
        );
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, targetEmployeeId, currentCalendarYear]);

  // Fetch holidays, assignments, and offices when modal is open and date range is valid
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!formState.start_date || !formState.end_date || formState.end_date < formState.start_date) {
      // oxlint-disable-next-line react/set-state-in-effect
      setHolidaysInRange([]);
      // oxlint-disable-next-line react/set-state-in-effect
      setAssignments([]);
      // oxlint-disable-next-line react/set-state-in-effect
      setSelectedOptionalHolidays([]);
      // oxlint-disable-next-line react/set-state-in-effect
      setIsLoadingHolidays(false);
      // oxlint-disable-next-line react/set-state-in-effect
      setHolidayFetchError(null);
      // oxlint-disable-next-line react/set-state-in-effect
      setAssignmentWarning(null);
      return;
    }

    let isMounted = true;
    setIsLoadingHolidays(true);
    setHolidayFetchError(null);
    setAssignmentWarning(null);

    const loadData = async () => {
      try {
        const holidaysPromise = getHolidays({
          start_date: formState.start_date,
          end_date: formState.end_date,
          include_org_wide: true,
        });

        const officesPromise = getOffices().catch(() => [] as Office[]);

        let empAssignments: OfficeAssignment[] = [];
        let asgnWarning: string | null = null;
        if (targetEmployeeId && targetEmployeeId > 0) {
          try {
            const fetchedAsgns = await getAssignments({ employee_id: targetEmployeeId });
            if (Array.isArray(fetchedAsgns)) {
              empAssignments = fetchedAsgns;
            }
          } catch {
            asgnWarning =
              'Unable to verify employee office assignments. Office-specific optional holidays are not available.';
          }
        }

        const [holidaysRes, officesRes] = await Promise.all([holidaysPromise, officesPromise]);

        if (!isMounted) return;

        const offMap = new Map<number, Office>(officesRes.map((o) => [o.id, o]));
        setOfficesMap(offMap);
        setAssignments(empAssignments);
        setAssignmentWarning(asgnWarning);
        setHolidaysInRange(holidaysRes.items);
        setHolidayFetchError(null);

        // Filter valid applicable optional holidays for selection cleanup
        const validApplicableDates = new Set(
          holidaysRes.items
            .filter((h) => {
              if (!h.is_optional) return false;
              if (h.office_id === null || h.office_id === undefined) return true;
              if (asgnWarning !== null) return false;
              const effAsgn = findEffectiveAssignment(h.holiday_date, empAssignments, offMap);
              return effAsgn !== null && effAsgn.office_id === h.office_id;
            })
            .map((h) => h.holiday_date)
        );

        setSelectedOptionalHolidays((prev) => prev.filter((d) => validApplicableDates.has(d)));
      } catch (err) {
        if (!isMounted) return;
        setHolidaysInRange([]);
        setAssignments([]);
        setHolidayFetchError(
          err instanceof ApiError ? err.message : 'Failed to load holidays for this date range.'
        );
      } finally {
        if (isMounted) {
          setIsLoadingHolidays(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, formState.start_date, formState.end_date, targetEmployeeId]);

  // Derive applicable optional holidays based on date-specific office assignments
  const applicableOptionalHolidays = useMemo(() => {
    return holidaysInRange.filter((h) => {
      if (!h.is_optional) return false;
      // Organization-wide optional holidays are always applicable
      if (h.office_id === null || h.office_id === undefined) return true;
      // If assignment lookup failed, exclude office-specific optional holidays
      if (assignmentWarning !== null) return false;
      // Office-specific optional holiday must match the effective office on that date
      const effAsgn = findEffectiveAssignment(h.holiday_date, assignments, officesMap);
      return effAsgn !== null && effAsgn.office_id === h.office_id;
    });
  }, [holidaysInRange, assignments, officesMap, assignmentWarning]);

  // Derive estimated working-day count reactively
  const workingDaysPreview = useMemo(() => {
    if (
      !isOpen ||
      !formState.start_date ||
      !formState.end_date ||
      formState.end_date < formState.start_date
    ) {
      return null;
    }
    return calculateWorkingDays(
      formState.start_date,
      formState.end_date,
      holidaysInRange,
      new Set(selectedOptionalHolidays),
      assignments,
      officesMap
    );
  }, [
    isOpen,
    formState.start_date,
    formState.end_date,
    holidaysInRange,
    selectedOptionalHolidays,
    assignments,
    officesMap,
  ]);

  // Selected leave type balance & enforcement resolution
  const selectedBalance = useMemo<LeaveTypeBalance | null>(() => {
    if (!balancesSummary?.balances) return null;
    return (
      balancesSummary.balances.find(
        (b) => b.leave_type.toUpperCase() === formState.leave_type.toUpperCase()
      ) || null
    );
  }, [balancesSummary, formState.leave_type]);

  // Check if requested working days exceed available balance for enforced leave types
  const hasInsufficientBalance = useMemo(() => {
    if (!selectedBalance || !selectedBalance.is_enforced || selectedBalance.available_days === null) {
      return false;
    }
    if (workingDaysPreview === null || workingDaysPreview <= 0) {
      return false;
    }
    return workingDaysPreview > selectedBalance.available_days;
  }, [selectedBalance, workingDaysPreview]);

  const handleEmployeeIdBlur = () => {
    setDebouncedEmployeeIdInput(formState.employee_id);
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.start_date.trim()) {
      newErrors.start_date = 'Start date is required.';
    }
    if (!formState.end_date.trim()) {
      newErrors.end_date = 'End date is required.';
    } else if (formState.start_date && formState.end_date < formState.start_date) {
      newErrors.end_date = 'End date cannot be earlier than start date.';
    }

    if (!isEmployee && formState.employee_id.trim()) {
      const parsed = parseInt(formState.employee_id.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        newErrors.employee_id = 'Please enter a valid positive Employee ID.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    const payload: LeaveRequestCreatePayload = {
      start_date: formState.start_date.trim(),
      end_date: formState.end_date.trim(),
      leave_type: formState.leave_type,
      reason: formState.reason.trim() || undefined,
    };

    if (!isEmployee && formState.employee_id.trim()) {
      payload.employee_id = parseInt(formState.employee_id.trim(), 10);
    }

    // Ensure only currently applicable selected optional holidays are submitted
    const validApplicableDates = new Set(applicableOptionalHolidays.map((h) => h.holiday_date));
    const activeSelected = selectedOptionalHolidays.filter((d) => validApplicableDates.has(d));

    if (activeSelected.length > 0) {
      payload.optional_holiday_dates = activeSelected;
    }

    onSubmit(payload);
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-modal-title"
      >
        <div className="modal-header">
          <h2 id="leave-modal-title">Request Leave</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close leave request modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {serverError && (
              <div className="alert-banner error" role="alert" style={{ marginBottom: '1rem' }}>
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{serverError}</span>
                </div>
              </div>
            )}

            {/* Employee ID (Admin/Manager only) */}
            {!isEmployee && (
              <div className="form-group">
                <label htmlFor="leave-emp-id">
                  Target Employee ID <span className="text-muted">(Optional, defaults to self)</span>
                </label>
                <input
                  id="leave-emp-id"
                  type="number"
                  min="1"
                  className={`form-input ${errors.employee_id ? 'input-error' : ''}`}
                  placeholder="e.g. 101"
                  value={formState.employee_id}
                  onChange={(e) => setFormState({ ...formState, employee_id: e.target.value })}
                  onBlur={handleEmployeeIdBlur}
                  disabled={isSubmitting}
                />
                {errors.employee_id && (
                  <span className="field-error" role="alert">
                    {errors.employee_id}
                  </span>
                )}
              </div>
            )}

            {/* Leave Type */}
            <div className="form-group">
              <label htmlFor="leave-type">Leave Category *</label>
              <select
                id="leave-type"
                className="form-select"
                value={formState.leave_type}
                onChange={(e) =>
                  setFormState({ ...formState, leave_type: e.target.value as LeaveType })
                }
                disabled={isSubmitting}
              >
                <option value="ANNUAL">Annual Leave (Planned / Vacation)</option>
                <option value="SICK">Sick Leave (Medical / Health)</option>
                <option value="CASUAL">Casual Leave (Urgent / Personal)</option>
                <option value="UNPAID">Unpaid Leave</option>
              </select>

              {/* Leave Balance Indicator */}
              {isLoadingBalances ? (
                <div
                  data-testid="leave-balance-loading"
                  className="text-muted"
                  style={{ fontSize: '0.85rem', marginTop: '6px', fontStyle: 'italic' }}
                >
                  Checking available balance...
                </div>
              ) : balanceFetchError ? (
                <div
                  data-testid="leave-balance-error"
                  className="alert-banner warning"
                  style={{ marginTop: '6px', padding: '6px 10px', fontSize: '0.85rem' }}
                >
                  <div className="alert-content">
                    <span aria-hidden="true">⚠️</span>
                    <span>Unable to load balance: {balanceFetchError}</span>
                  </div>
                </div>
              ) : selectedBalance ? (
                selectedBalance.is_enforced && selectedBalance.available_days !== null ? (
                  <div
                    data-testid="leave-balance-display"
                    style={{
                      marginTop: '6px',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>Available Balance:</span>
                    <strong
                      data-testid="available-days-count"
                      style={{
                        color: selectedBalance.available_days > 0 ? '#0f766e' : '#b91c1c',
                        fontSize: '0.9rem',
                      }}
                    >
                      {selectedBalance.available_days}{' '}
                      {selectedBalance.available_days === 1 ? 'day' : 'days'}
                    </strong>
                    <span data-testid="allocated-days-count" className="text-muted">
                      of {selectedBalance.allocated_days ?? 0}{' '}
                      {selectedBalance.allocated_days === 1 ? 'day' : 'days'} allocated
                    </span>
                    {selectedBalance.pending_days > 0 && (
                      <span className="text-muted" data-testid="pending-days-count">
                        ({selectedBalance.pending_days}d pending)
                      </span>
                    )}
                    {selectedBalance.is_override && (
                      <span
                        data-testid="balance-override-badge"
                        style={{
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
                  </div>
                ) : (
                  <div
                    data-testid="leave-balance-unconfigured"
                    style={{ marginTop: '6px', fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}
                  >
                    Balance enforcement is not configured for this leave category.
                  </div>
                )
              ) : null}
            </div>

            {/* Date Range */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="leave-modal-start-date">Start Date *</label>
                <input
                  id="leave-modal-start-date"
                  data-testid="leave-start-date-input"
                  type="date"
                  className={`form-input ${errors.start_date ? 'input-error' : ''}`}
                  value={formState.start_date}
                  onChange={(e) => setFormState({ ...formState, start_date: e.target.value })}
                  disabled={isSubmitting}
                  required
                />
                {errors.start_date && (
                  <span className="field-error" role="alert">
                    {errors.start_date}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="leave-modal-end-date">End Date *</label>
                <input
                  id="leave-modal-end-date"
                  data-testid="leave-end-date-input"
                  type="date"
                  className={`form-input ${errors.end_date ? 'input-error' : ''}`}
                  value={formState.end_date}
                  onChange={(e) => setFormState({ ...formState, end_date: e.target.value })}
                  disabled={isSubmitting}
                  required
                />
                {errors.end_date && (
                  <span className="field-error" role="alert">
                    {errors.end_date}
                  </span>
                )}
              </div>
            </div>

            {/* Range validation error banner */}
            {errors.date_range && (
              <div
                className="alert-banner error"
                role="alert"
                data-testid="date-range-error"
                style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}
              >
                <div className="alert-content">
                  <span aria-hidden="true">⚠️</span>
                  <span>{errors.date_range}</span>
                </div>
              </div>
            )}

            {/* Live Working-Day Preview */}
            <div
              className="form-group"
              data-testid="working-days-preview-container"
              style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}
            >
              {isLoadingHolidays ? (
                <div
                  data-testid="working-days-loading"
                  className="text-muted"
                  style={{ fontSize: '0.9rem', fontStyle: 'italic' }}
                >
                  Calculating estimated duration...
                </div>
              ) : workingDaysPreview !== null ? (
                <div>
                  <div
                    data-testid="working-days-preview"
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color: workingDaysPreview === 0 ? '#b91c1c' : '#1e293b',
                    }}
                  >
                    Estimated Duration: {workingDaysPreview}{' '}
                    {workingDaysPreview === 1 ? 'working day' : 'working days'}
                  </div>
                  {workingDaysPreview === 0 && (
                    <div
                      data-testid="zero-working-days-warning"
                      className="alert-banner warning"
                      role="alert"
                      style={{ marginTop: '0.5rem', padding: '6px 10px', fontSize: '0.85rem' }}
                    >
                      <div className="alert-content">
                        <span aria-hidden="true">⚠️</span>
                        <span>
                          Requested leave range contains zero working days and cannot be submitted.
                        </span>
                      </div>
                    </div>
                  )}
                  {hasInsufficientBalance && (
                    <div
                      data-testid="insufficient-balance-warning"
                      className="alert-banner warning"
                      role="alert"
                      style={{ marginTop: '0.5rem', padding: '6px 10px', fontSize: '0.85rem' }}
                    >
                      <div className="alert-content">
                        <span aria-hidden="true">⚠️</span>
                        <span>
                          Requested leave duration ({workingDaysPreview}{' '}
                          {workingDaysPreview === 1 ? 'working day' : 'working days'}) exceeds your available balance (
                          {selectedBalance?.available_days}{' '}
                          {selectedBalance?.available_days === 1 ? 'day' : 'days'}). The request may be
                          rejected by policy.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Optional / Restricted Holidays in Range */}
            <div className="form-group" data-testid="optional-holidays-group">
              <label className="field-label">Optional / Restricted Holidays in Range</label>

              {assignmentWarning && (
                <div
                  className="alert-banner warning"
                  role="alert"
                  data-testid="assignment-warning"
                  style={{ marginTop: '0.25rem', marginBottom: '0.5rem', padding: '6px 10px', fontSize: '0.85rem' }}
                >
                  <div className="alert-content">
                    <span aria-hidden="true">⚠️</span>
                    <span>{assignmentWarning}</span>
                  </div>
                </div>
              )}

              {holidayFetchError ? (
                <div
                  className="alert-banner error"
                  role="alert"
                  data-testid="optional-holidays-error"
                  style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}
                >
                  <div className="alert-content">
                    <span aria-hidden="true">⚠️</span>
                    <span>{holidayFetchError}</span>
                  </div>
                </div>
              ) : isLoadingHolidays ? (
                <div
                  data-testid="optional-holidays-loading"
                  className="text-muted"
                  style={{ fontSize: '0.85rem', padding: '0.25rem 0' }}
                >
                  Loading optional holidays...
                </div>
              ) : applicableOptionalHolidays.length === 0 ? (
                <p
                  data-testid="no-optional-holidays-msg"
                  className="text-muted"
                  style={{ fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}
                >
                  No optional holidays in this date range.
                </p>
              ) : (
                <>
                  <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                    Select any optional holidays you wish to exclude from your leave duration:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {applicableOptionalHolidays.map((h) => (
                      <label
                        key={h.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          data-testid={`optional-holiday-${h.holiday_date}`}
                          checked={selectedOptionalHolidays.includes(h.holiday_date)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOptionalHolidays([...selectedOptionalHolidays, h.holiday_date]);
                            } else {
                              setSelectedOptionalHolidays(
                                selectedOptionalHolidays.filter((d) => d !== h.holiday_date)
                              );
                            }
                          }}
                          disabled={isSubmitting}
                        />
                        <span>
                          <strong>{h.name}</strong> ({h.holiday_date})
                          {h.office_name ? ` — ${h.office_name}` : ' — Organization-wide'}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Reason */}
            <div className="form-group">
              <label htmlFor="leave-reason">
                Reason / Notes <span className="text-muted">(Optional)</span>
              </label>
              <textarea
                id="leave-reason"
                className="form-textarea"
                rows={3}
                placeholder="Provide details or justification for your leave request..."
                value={formState.reason}
                onChange={(e) => setFormState({ ...formState, reason: e.target.value })}
                disabled={isSubmitting}
                maxLength={1000}
                data-testid="leave-reason-input"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
              data-testid="submit-leave-btn"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
