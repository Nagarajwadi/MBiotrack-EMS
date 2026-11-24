import { apiFetch } from './client';
import type {
  EmployeeLeaveBalanceSummary,
  EmployeeLeaveEntitlement,
  LeaveBalanceLedgerItem,
  LeaveEntitlementDefault,
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
  if (params?.department && params.department.trim() && params.department.trim().toUpperCase() !== 'ALL') {
    query.set('department', params.department.trim());
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

export async function getEmployeeLeaveBalances(
  employeeId: number,
  year?: number
): Promise<EmployeeLeaveBalanceSummary> {
  const query = year ? `?year=${year}` : '';
  return apiFetch<EmployeeLeaveBalanceSummary>(`${LEAVES_BASE}/balances/${employeeId}${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getEmployeeBalanceLedger(
  employeeId: number,
  year?: number
): Promise<LeaveBalanceLedgerItem[]> {
  const query = year ? `?year=${year}` : '';
  return apiFetch<LeaveBalanceLedgerItem[]>(`${LEAVES_BASE}/ledger/${employeeId}${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getEntitlementDefaults(
  year?: number
): Promise<LeaveEntitlementDefault[]> {
  const query = year ? `?year=${year}` : '';
  return apiFetch<LeaveEntitlementDefault[]>(`${LEAVES_BASE}/entitlements/defaults${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function setEntitlementDefault(payload: {
  year: number;
  leave_type: string;
  allocated_days: number;
}): Promise<LeaveEntitlementDefault> {
  return apiFetch<LeaveEntitlementDefault>(`${LEAVES_BASE}/entitlements/defaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteEntitlementDefault(defaultId: number): Promise<void> {
  await apiFetch<void>(`${LEAVES_BASE}/entitlements/defaults/${defaultId}`, {
    method: 'DELETE',
  });
}

export async function getEntitlementOverrides(
  year?: number,
  employeeId?: number
): Promise<EmployeeLeaveEntitlement[]> {
  const params = new URLSearchParams();
  if (year !== undefined) params.set('year', String(year));
  if (employeeId !== undefined) params.set('employee_id', String(employeeId));
  const query = params.toString() ? `?${params.toString()}` : '';

  return apiFetch<EmployeeLeaveEntitlement[]>(`${LEAVES_BASE}/entitlements/overrides${query}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function setEntitlementOverride(payload: {
  employee_id: number;
  year: number;
  leave_type: string;
  allocated_days: number;
}): Promise<EmployeeLeaveEntitlement> {
  return apiFetch<EmployeeLeaveEntitlement>(`${LEAVES_BASE}/entitlements/overrides`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteEntitlementOverride(overrideId: number): Promise<void> {
  await apiFetch<void>(`${LEAVES_BASE}/entitlements/overrides/${overrideId}`, {
    method: 'DELETE',
  });
}
