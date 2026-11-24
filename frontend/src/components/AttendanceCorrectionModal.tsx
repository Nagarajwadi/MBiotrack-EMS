import React, { useState } from 'react';
import { createAttendanceCorrection } from '../api/attendanceApi';
import { ApiError } from '../api/apiError';
import type { User } from '../types/auth';
import type {
  AttendanceCorrectionCreate,
  AttendanceCorrectionResponse,
  AttendanceCorrectionType,
  DailyPunchDetail,
} from '../types/attendance';
import './components.css';

export interface AttendanceCorrectionModalProps {
  isOpen: boolean;
  currentUser: User;
  targetEmployeeId?: number | null;
  targetEmployeeName?: string | null;
  targetEmployeeCode?: string | null;
  attendanceDate?: string;
  initialCorrectionType?: AttendanceCorrectionType;
  initialOriginalEventId?: number | null;
  availablePunches?: DailyPunchDetail[];
  onClose: () => void;
  onSuccess: (correction: AttendanceCorrectionResponse) => void;
}

function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const AttendanceCorrectionModal: React.FC<AttendanceCorrectionModalProps> = ({
  isOpen,
  currentUser,
  targetEmployeeId,
  targetEmployeeName,
  targetEmployeeCode,
  attendanceDate,
  initialCorrectionType = 'MISSING_CHECK_OUT',
  initialOriginalEventId,
  availablePunches = [],
  onClose,
  onSuccess,
}) => {
  const [trackedOpen, setTrackedOpen] = useState(isOpen);
  const [correctionType, setCorrectionType] = useState<AttendanceCorrectionType>(initialCorrectionType);
  const [dateVal, setDateVal] = useState<string>(() => attendanceDate || getTodayDateString());
  const [timeVal, setTimeVal] = useState<string>('18:00');
  const [originalEventId, setOriginalEventId] = useState<string>(() =>
    initialOriginalEventId ? String(initialOriginalEventId) : (availablePunches.length > 0 ? String(availablePunches[0].id) : '')
  );
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state when modal opens
  if (trackedOpen !== isOpen) {
    setTrackedOpen(isOpen);
    if (isOpen) {
      setCorrectionType(initialCorrectionType);
      setDateVal(attendanceDate || getTodayDateString());

      const targetPunch = initialOriginalEventId
        ? availablePunches.find((p) => p.id === initialOriginalEventId)
        : (availablePunches.length > 0 ? availablePunches[0] : null);

      if (initialCorrectionType === 'TIMESTAMP_ADJUSTMENT' && targetPunch) {
        try {
          const d = new Date(targetPunch.event_timestamp);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          setTimeVal(`${hh}:${mm}`);
        } catch {
          setTimeVal('18:00');
        }
      } else {
        setTimeVal(initialCorrectionType === 'MISSING_CHECK_IN' ? '09:00' : '18:00');
      }

      setOriginalEventId(
        initialOriginalEventId
          ? String(initialOriginalEventId)
          : (availablePunches.length > 0 ? String(availablePunches[0].id) : '')
      );
      setReason('');
      setErrorMsg(null);
      setIsSubmitting(false);
    }
  }

  // Keyboard accessibility: ESC key dismisses modal
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const resolvedEmployeeId = targetEmployeeId ?? currentUser.employee_id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!resolvedEmployeeId) {
      setErrorMsg('No employee ID resolved. Cannot submit correction.');
      return;
    }
    if (!dateVal.trim()) {
      setErrorMsg('Please select a valid attendance date.');
      return;
    }
    if (!timeVal.trim()) {
      setErrorMsg('Please enter a proposed punch time.');
      return;
    }
    if (reason.trim().length < 5) {
      setErrorMsg('Reason must be at least 5 characters long.');
      return;
    }

    if (correctionType === 'TIMESTAMP_ADJUSTMENT' && !originalEventId) {
      setErrorMsg('Please select the original punch event to adjust.');
      return;
    }

    // Build ISO timestamp with local timezone offset
    const timeParts = timeVal.split(':');
    const hours = timeParts[0].padStart(2, '0');
    const mins = (timeParts[1] || '00').padStart(2, '0');
    const secs = (timeParts[2] || '00').padStart(2, '0');

    // Create Date object in local time and export ISO string
    const localDate = new Date(`${dateVal}T${hours}:${mins}:${secs}`);
    if (isNaN(localDate.getTime())) {
      setErrorMsg('Invalid date or time entered.');
      return;
    }

    // Construct local ISO string with offset
    const tzo = -localDate.getTimezoneOffset();
    const dif = tzo >= 0 ? '+' : '-';
    const pad = (num: number) => String(Math.floor(Math.abs(num))).padStart(2, '0');
    const proposedIso = `${dateVal}T${hours}:${mins}:${secs}${dif}${pad(tzo / 60)}:${pad(tzo % 60)}`;

    const idempKey = `corr-${resolvedEmployeeId}-${dateVal}-${correctionType}-${Date.now()}`;

    const payload: AttendanceCorrectionCreate = {
      employee_id: resolvedEmployeeId,
      attendance_date: dateVal,
      correction_type: correctionType,
      proposed_timestamp: proposedIso,
      original_event_id: correctionType === 'TIMESTAMP_ADJUSTMENT' ? Number(originalEventId) : null,
      reason: reason.trim(),
      idempotency_key: idempKey,
    };

    setIsSubmitting(true);
    try {
      const response = await createAttendanceCorrection(payload);
      setIsSubmitting(false);
      onSuccess(response);
      onClose();
    } catch (err: unknown) {
      setIsSubmitting(false);
      if (err instanceof ApiError) {
        setErrorMsg(err.message || 'Failed to submit correction request.');
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('An unexpected error occurred.');
      }
    }
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
        className="modal-dialog attendance-correction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="correction-modal-title">Request Attendance Correction</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {errorMsg && (
              <div className="alert alert-danger" role="alert">
                {errorMsg}
              </div>
            )}

            <div className="form-group mb-3">
              <label className="form-label">Employee</label>
              <input
                type="text"
                className="form-control"
                value={
                  targetEmployeeName
                    ? `${targetEmployeeName} (${targetEmployeeCode || `ID: ${resolvedEmployeeId}`})`
                    : `Employee ID: ${resolvedEmployeeId ?? 'Unknown'}`
                }
                disabled
              />
            </div>

            <div className="form-group mb-3">
              <label htmlFor="correction-date" className="form-label">
                Attendance Date
              </label>
              <input
                id="correction-date"
                type="date"
                className="form-control"
                value={dateVal}
                onChange={(e) => setDateVal(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="form-group mb-3">
              <label htmlFor="correction-type" className="form-label">
                Correction Type
              </label>
              <select
                id="correction-type"
                className="form-select"
                value={correctionType}
                onChange={(e) => {
                  const newType = e.target.value as AttendanceCorrectionType;
                  setCorrectionType(newType);
                  if (newType === 'TIMESTAMP_ADJUSTMENT') {
                    const fallbackId = originalEventId || (availablePunches.length > 0 ? String(availablePunches[0].id) : '');
                    if (!originalEventId && fallbackId) {
                      setOriginalEventId(fallbackId);
                    }
                    const punch = availablePunches.find((p) => String(p.id) === fallbackId);
                    if (punch) {
                      try {
                        const d = new Date(punch.event_timestamp);
                        const hh = String(d.getHours()).padStart(2, '0');
                        const mm = String(d.getMinutes()).padStart(2, '0');
                        setTimeVal(`${hh}:${mm}`);
                      } catch {
                        // keep current
                      }
                    }
                  } else if (newType === 'MISSING_CHECK_IN') {
                    setTimeVal('09:00');
                  } else {
                    setTimeVal('18:00');
                  }
                }}
                disabled={isSubmitting}
              >
                <option value="MISSING_CHECK_OUT">Missing Check-Out</option>
                <option value="MISSING_CHECK_IN">Missing Check-In</option>
                <option value="TIMESTAMP_ADJUSTMENT">Adjust Existing Punch</option>
              </select>
            </div>

            {correctionType === 'TIMESTAMP_ADJUSTMENT' && (
              <div className="form-group mb-3">
                <label htmlFor="original-event-select" className="form-label">
                  Original Punch to Adjust
                </label>
                {availablePunches.length > 0 ? (
                  <select
                    id="original-event-select"
                    className="form-select"
                    value={originalEventId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setOriginalEventId(newId);
                      const punch = availablePunches.find((p) => String(p.id) === newId);
                      if (punch) {
                        try {
                          const d = new Date(punch.event_timestamp);
                          const hh = String(d.getHours()).padStart(2, '0');
                          const mm = String(d.getMinutes()).padStart(2, '0');
                          setTimeVal(`${hh}:${mm}`);
                        } catch {
                          // keep current
                        }
                      }
                    }}
                    disabled={isSubmitting}
                    required
                  >
                    <option value="">Select a punch...</option>
                    {availablePunches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.punch_type} at {new Date(p.event_timestamp).toLocaleTimeString()} ({p.office_name || 'Assigned Office'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="original-event-select"
                    type="number"
                    className="form-control"
                    placeholder="Enter original punch event ID"
                    value={originalEventId}
                    onChange={(e) => setOriginalEventId(e.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                )}
              </div>
            )}

            <div className="form-group mb-3">
              <label htmlFor="correction-time" className="form-label">
                Proposed Punch Time
              </label>
              <input
                id="correction-time"
                type="time"
                step="60"
                className="form-control"
                value={timeVal}
                onChange={(e) => setTimeVal(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="form-group mb-3">
              <label htmlFor="correction-reason" className="form-label">
                Justification Reason <span className="text-muted">(minimum 5 characters)</span>
              </label>
              <textarea
                id="correction-reason"
                className="form-control"
                rows={3}
                placeholder="Explain why this correction is required..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isSubmitting}
                required
                minLength={5}
                maxLength={1000}
              />
              <small className="form-text text-muted">{reason.length}/1000 characters</small>
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
              disabled={isSubmitting || reason.trim().length < 5}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
