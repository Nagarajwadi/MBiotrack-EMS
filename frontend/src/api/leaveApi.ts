import { apiFetch } from './client';
import type {
  LeaveFilterParams,
  LeaveRequestCreatePayload,
  LeaveRequestDetail,
  LeaveRequestListResponse,
  LeaveRequestReviewPayload,
} from '../types/leave';

const LEAVES_BASE = '/api/v1/leaves';

export async function submitLeaveRequest(
  payload: LeaveRequestCreatePayload
): Promise<LeaveRequestDetail> {
  return apiFetch<LeaveRequestDetail>(LEAVES_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function getLeaveRequests(
  params?: LeaveFilterParams
): Promise<LeaveRequestListResponse> {
  const query = new URLSearchParams();

  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }
  if (params?.status && params.status.trim()) {
    query.set('status', params.status.trim());
  }
  if (params?.leave_type && params.leave_type.trim()) {
    query.set('leave_type', params.leave_type.trim());
  }
  if (params?.start_date && params.start_date.trim()) {
    query.set('start_date', params.start_date.trim());
  }
  if (params?.end_date && params.end_date.trim()) {
    query.set('end_date', params.end_date.trim());
  }
  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    query.set('offset', String(params.offset));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${LEAVES_BASE}?${queryString}` : LEAVES_BASE;

  return apiFetch<LeaveRequestListResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getLeaveRequest(id: number): Promise<LeaveRequestDetail> {
  return apiFetch<LeaveRequestDetail>(`${LEAVES_BASE}/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function reviewLeaveRequest(
  id: number,
  payload: LeaveRequestReviewPayload
): Promise<LeaveRequestDetail> {
  return apiFetch<LeaveRequestDetail>(`${LEAVES_BASE}/${id}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function cancelLeaveRequest(id: number): Promise<LeaveRequestDetail> {
  return apiFetch<LeaveRequestDetail>(`${LEAVES_BASE}/${id}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  });
}
