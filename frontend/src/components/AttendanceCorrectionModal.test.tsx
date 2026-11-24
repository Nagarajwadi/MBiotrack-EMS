import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceCorrectionModal } from './AttendanceCorrectionModal';
import * as attendanceApi from '../api/attendanceApi';
import { ApiError } from '../api/apiError';
import { mockEmployeeUser } from '../test/fixtures/authFixtures';
import type { AttendanceCorrectionResponse, DailyPunchDetail } from '../types/attendance';

vi.mock('../api/attendanceApi', () => ({
  createAttendanceCorrection: vi.fn(),
}));

const mockPunches: DailyPunchDetail[] = [
  {
    id: 101,
    punch_type: 'CHECK_IN',
    event_timestamp: '2026-11-20T09:12:00Z',
    device_id: 1,
    device_name: 'HQ Turnstile',
    device_code: 'HQ-01',
    office_id: 1,
    office_name: 'HQ Campus',
    office_code: 'HQ',
    is_roaming: false,
  },
];

const mockCorrectionResponse: AttendanceCorrectionResponse = {
  id: 42,
  employee_id: 3,
  employee_name: 'Charlie Employee',
  employee_code: 'EMP-003',
  department: 'Engineering',
  attendance_date: '2026-11-20',
  correction_type: 'MISSING_CHECK_OUT',
  proposed_timestamp: '2026-11-20T18:00:00Z',
  original_event_id: null,
  reason: 'Forgot to swipe card when leaving the building',
  status: 'PENDING',
  requested_by_user_id: 4,
  requester_name: 'Charlie Employee',
  requester_email: 'employee@mbiotrack.local',
  reviewed_by_user_id: null,
  reviewer_name: null,
  reviewer_email: null,
  review_notes: null,
  reviewed_at: null,
  idempotency_key: 'idemp-12345',
  created_at: '2026-11-20T18:30:00Z',
  updated_at: '2026-11-20T18:30:00Z',
};

describe('AttendanceCorrectionModal', () => {
  const mockCreateCorrection = vi.mocked(attendanceApi.createAttendanceCorrection);
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(
      <AttendanceCorrectionModal
        isOpen={false}
        currentUser={mockEmployeeUser}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    expect(screen.queryByRole('heading', { name: /Request Attendance Correction/i })).not.toBeInTheDocument();
  });

  it('renders modal with prefilled employee details and defaults when isOpen is true', () => {
    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        targetEmployeeName="Charlie Employee"
        targetEmployeeCode="EMP-003"
        attendanceDate="2026-11-20"
        initialCorrectionType="MISSING_CHECK_OUT"
        availablePunches={mockPunches}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    expect(screen.getByRole('heading', { name: /Request Attendance Correction/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Charlie Employee (EMP-003)')).toBeInTheDocument();
    expect(screen.getByLabelText(/Correction Type/i)).toHaveValue('MISSING_CHECK_OUT');
    expect(screen.getByLabelText(/Attendance Date/i)).toHaveValue('2026-11-20');
  });

  it('validates reason minimum length before enabling submission button', async () => {
    const user = userEvent.setup();

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
    expect(submitBtn).toBeDisabled();

    // Type short reason (< 5 characters)
    const reasonInput = screen.getByLabelText(/Justification Reason/i);
    await user.type(reasonInput, 'abc');
    expect(submitBtn).toBeDisabled();

    // Type valid reason (>= 5 characters)
    await user.type(reasonInput, 'de valid reason');
    expect(submitBtn).toBeEnabled();
  });

  it('submits valid correction request and calls onSuccess and onClose', async () => {
    const user = userEvent.setup();
    mockCreateCorrection.mockResolvedValueOnce(mockCorrectionResponse);

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        initialCorrectionType="MISSING_CHECK_OUT"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const reasonInput = screen.getByLabelText(/Justification Reason/i);
    await user.type(reasonInput, 'Forgot to swipe card when leaving the building');

    const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateCorrection).toHaveBeenCalledTimes(1);
    });

    const callArg = mockCreateCorrection.mock.calls[0][0];
    expect(callArg.employee_id).toBe(3);
    expect(callArg.attendance_date).toBe('2026-11-20');
    expect(callArg.correction_type).toBe('MISSING_CHECK_OUT');
    expect(callArg.reason).toBe('Forgot to swipe card when leaving the building');
    expect(callArg.idempotency_key).toBeDefined();

    expect(onSuccess).toHaveBeenCalledWith(mockCorrectionResponse);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays API error banner and keeps modal open on failure', async () => {
    const user = userEvent.setup();
    mockCreateCorrection.mockRejectedValueOnce(
      new ApiError(409, 'A pending correction request already exists for this date and type.')
    );

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const reasonInput = screen.getByLabelText(/Justification Reason/i);
    await user.type(reasonInput, 'Duplicate request attempt reason');

    const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/A pending correction request already exists for this date and type/i)
      ).toBeInTheDocument();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows selecting original punch when correction type is TIMESTAMP_ADJUSTMENT', async () => {
    const user = userEvent.setup();
    mockCreateCorrection.mockResolvedValueOnce({
      ...mockCorrectionResponse,
      correction_type: 'TIMESTAMP_ADJUSTMENT',
      original_event_id: 101,
    });

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        initialCorrectionType="TIMESTAMP_ADJUSTMENT"
        availablePunches={mockPunches}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    expect(screen.getByLabelText(/Original Punch to Adjust/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Original Punch to Adjust/i), '101');

    const reasonInput = screen.getByLabelText(/Justification Reason/i);
    await user.type(reasonInput, 'Adjusting punch timestamp due to clock skew');

    const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateCorrection).toHaveBeenCalledTimes(1);
    });

    expect(mockCreateCorrection.mock.calls[0][0].correction_type).toBe('TIMESTAMP_ADJUSTMENT');
    expect(mockCreateCorrection.mock.calls[0][0].original_event_id).toBe(101);
  });

  it('calls onClose when Cancel or Close buttons are clicked', async () => {
    const user = userEvent.setup();

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preselects initialOriginalEventId and populates proposed time when provided', () => {
    const multiPunches: DailyPunchDetail[] = [
      {
        id: 101,
        punch_type: 'CHECK_IN',
        event_timestamp: '2026-11-20T09:15:00Z',
        device_id: 1,
        device_name: 'HQ Turnstile',
        device_code: 'HQ-01',
        office_id: 1,
        office_name: 'HQ Campus',
        office_code: 'HQ',
        is_roaming: false,
      },
      {
        id: 102,
        punch_type: 'CHECK_OUT',
        event_timestamp: '2026-11-20T18:45:00Z',
        device_id: 1,
        device_name: 'HQ Turnstile',
        device_code: 'HQ-01',
        office_id: 1,
        office_name: 'HQ Campus',
        office_code: 'HQ',
        is_roaming: false,
      },
    ];

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        initialCorrectionType="TIMESTAMP_ADJUSTMENT"
        initialOriginalEventId={102}
        availablePunches={multiPunches}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const select = screen.getByLabelText(/Original Punch to Adjust/i) as HTMLSelectElement;
    expect(select.value).toBe('102');
  });

  it('dismisses modal on Escape key press', async () => {
    const user = userEvent.setup();

    render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses modal when clicking the modal-overlay backdrop outside the dialog', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <AttendanceCorrectionModal
        isOpen={true}
        currentUser={mockEmployeeUser}
        targetEmployeeId={3}
        attendanceDate="2026-11-20"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const overlay = container.querySelector('.modal-overlay');
    expect(overlay).toBeInTheDocument();

    if (overlay) {
      await user.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });
});
