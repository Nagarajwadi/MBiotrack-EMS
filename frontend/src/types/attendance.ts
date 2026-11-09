export interface AttendanceEventDetail {
  id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  department: string | null;
  device_id: number;
  device_name: string | null;
  device_code: string | null;
  office_id: number;
  office_name: string | null;
  office_code: string | null;
  punch_type: 'CHECK_IN' | 'CHECK_OUT' | string;
  event_timestamp: string;
  is_roaming: boolean;
  idempotency_key: string | null;
  actor_user_id: number;
  created_at: string;
}

export interface AttendanceListResponse {
  items: AttendanceEventDetail[];
  total: number;
  limit: number;
  offset: number;
}

export interface AttendanceFilterParams {
  employee_id?: number;
  office_id?: number;
  device_id?: number;
  punch_type?: string;
  start_date?: string;
  end_date?: string;
  is_roaming?: boolean;
  scope?: string;
  limit?: number;
  offset?: number;
}

export interface DailyPunchDetail {
  id: number;
  punch_type: string;
  event_timestamp: string;
  device_id: number;
  device_name: string | null;
  device_code: string | null;
  office_id: number;
  office_name: string | null;
  office_code: string | null;
  is_roaming: boolean;
}

export type AttendanceReviewStatus = 'NO_PUNCH' | 'NORMAL' | 'REQUIRES_REVIEW' | 'ACKNOWLEDGED';

export interface AttendanceReviewResponse {
  id: number;
  employee_id: number;
  attendance_date: string;
  reviewed_by_user_id: number;
  reviewer_name: string;
  reviewer_email: string;
  review_status: string;
  review_notes: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface AttendanceReviewCreate {
  employee_id: number;
  attendance_date: string;
  review_status?: 'ACKNOWLEDGED';
  review_notes?: string | null;
  idempotency_key: string;
}

export interface AttendanceReviewHistoryResponse {
  employee_id: number;
  items: AttendanceReviewResponse[];
  total_items: number;
}

export interface AttendanceExceptionItem {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department: string | null;
  assigned_office_id: number | null;
  assigned_office_name: string | null;
  attendance_date: string;
  punch_count: number;
  first_punch: string | null;
  last_punch: string | null;
  has_roaming: boolean;
  roaming_count: number;
  review_status: string;
  review_reason: string | null;
  latest_review?: AttendanceReviewResponse | null;
  punches: DailyPunchDetail[];
}

export interface AttendanceExceptionListResponse {
  date: string;
  total_exceptions: number;
  items: AttendanceExceptionItem[];
}

export interface EmployeeDailyAttendanceItem {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department: string | null;
  assigned_office_id: number | null;
  assigned_office_name: string | null;
  assigned_office_code: string | null;
  punch_count: number;
  first_punch: string | null;
  last_punch: string | null;
  has_roaming: boolean;
  roaming_count: number;
  review_status: AttendanceReviewStatus;
  review_reason: string | null;
  latest_review?: AttendanceReviewResponse | null;
  punches: DailyPunchDetail[];
}

export interface DailyAttendanceSummary {
  date: string;
  total_events: number;
  employees_with_punches: number;
  employees_without_punches: number;
  requires_review_count: number;
  roaming_punch_count: number;
  eligible_employee_count: number;
}

export interface DailyAttendanceOperationsResponse {
  summary: DailyAttendanceSummary;
  employees: EmployeeDailyAttendanceItem[];
  total_employees: number;
  limit: number;
  offset: number;
}

export interface DailyOperationsFilterParams {
  date?: string;
  office_id?: number;
  employee_id?: number;
  limit?: number;
  offset?: number;
}

export interface AttendanceReportItem {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department: string | null;
  office_id: number | null;
  office_name: string | null;
  office_code: string | null;
  attendance_date: string;
  punch_count: number;
  first_punch: string | null;
  last_punch: string | null;
  has_roaming: boolean;
  roaming_count: number;
  status: 'NORMAL' | 'REQUIRES_REVIEW' | 'NO_PUNCH' | string;
}

export interface AttendanceReportSummary {
  start_date: string;
  end_date: string;
  total_events: number;
  employees_with_punches: number;
  employees_without_punches: number;
  roaming_punch_count: number;
  total_records: number;
  eligible_employee_count: number;
}

export interface AttendanceReportResponse {
  summary: AttendanceReportSummary;
  items: AttendanceReportItem[];
  total_items: number;
  limit: number;
  offset: number;
}

export interface AttendanceReportFilterParams {
  start_date?: string;
  end_date?: string;
  office_id?: number;
  employee_id?: number;
  limit?: number;
  offset?: number;
}

export interface AttendancePunchCreatePayload {
  employee_id?: number | null;
  device_id: number;
  punch_type: 'CHECK_IN' | 'CHECK_OUT';
  punch_time?: string | null;
  idempotency_key?: string | null;
}

export interface AttendancePunchResponse {
  id: number;
  employee_id: number;
  device_id: number;
  office_id: number;
  punch_type: 'CHECK_IN' | 'CHECK_OUT';
  event_timestamp: string;
  is_roaming: boolean;
  idempotency_key: string | null;
  actor_user_id: number;
  created_at: string;
  notes: string | null;
}
