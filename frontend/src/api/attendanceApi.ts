import { apiFetch, apiFetchBlob } from './client';
import type {
  AttendanceFilterParams,
  AttendanceListResponse,
  AttendanceReportFilterParams,
  AttendanceReportResponse,
  DailyAttendanceOperationsResponse,
  DailyOperationsFilterParams,
} from '../types/attendance';

const ATTENDANCE_BASE = '/api/v1/attendance';

export async function getAttendanceRecords(
  params?: AttendanceFilterParams
): Promise<AttendanceListResponse> {
  const query = new URLSearchParams();

  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    query.set('offset', String(params.offset));
  }
  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.device_id !== undefined && params.device_id !== null) {
    query.set('device_id', String(params.device_id));
  }
  if (params?.punch_type && params.punch_type.trim()) {
    query.set('punch_type', params.punch_type.trim());
  }
  if (params?.start_date && params.start_date.trim()) {
    query.set('start_date', params.start_date.trim());
  }
  if (params?.end_date && params.end_date.trim()) {
    query.set('end_date', params.end_date.trim());
  }
  if (params?.is_roaming !== undefined && params.is_roaming !== null) {
    query.set('is_roaming', String(params.is_roaming));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${ATTENDANCE_BASE}?${queryString}` : ATTENDANCE_BASE;

  return apiFetch<AttendanceListResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getDailyAttendanceOperations(
  params?: DailyOperationsFilterParams
): Promise<DailyAttendanceOperationsResponse> {
  const query = new URLSearchParams();

  if (params?.date && params.date.trim()) {
    query.set('date', params.date.trim());
  }
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }
  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    query.set('offset', String(params.offset));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${ATTENDANCE_BASE}/daily-summary?${queryString}` : `${ATTENDANCE_BASE}/daily-summary`;

  return apiFetch<DailyAttendanceOperationsResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getAttendanceReport(
  params?: AttendanceReportFilterParams
): Promise<AttendanceReportResponse> {
  const query = new URLSearchParams();

  if (params?.start_date && params.start_date.trim()) {
    query.set('start_date', params.start_date.trim());
  }
  if (params?.end_date && params.end_date.trim()) {
    query.set('end_date', params.end_date.trim());
  }
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }
  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    query.set('offset', String(params.offset));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${ATTENDANCE_BASE}/report?${queryString}` : `${ATTENDANCE_BASE}/report`;

  return apiFetch<AttendanceReportResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function downloadAttendanceReportCsv(
  params?: AttendanceReportFilterParams
): Promise<Blob> {
  const query = new URLSearchParams();

  if (params?.start_date && params.start_date.trim()) {
    query.set('start_date', params.start_date.trim());
  }
  if (params?.end_date && params.end_date.trim()) {
    query.set('end_date', params.end_date.trim());
  }
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }

  const queryString = query.toString();
  const endpoint = queryString
    ? `${ATTENDANCE_BASE}/report/export-csv?${queryString}`
    : `${ATTENDANCE_BASE}/report/export-csv`;

  return apiFetchBlob(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'text/csv',
    },
  });
}
