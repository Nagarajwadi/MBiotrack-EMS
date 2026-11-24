export type LeaveType = 'ANNUAL' | 'SICK' | 'CASUAL' | 'UNPAID';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequestDetail {
  id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  department: string | null;
  start_date: string;
  end_date: string;
  leave_type: LeaveType | string;
  reason: string | null;
  status: LeaveStatus | string;
  working_days: number | null;
  decision_by_user_id: number | null;
  decision_by_user_name: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  allocated_days?: number | null;
  available_days_before?: number | null;
  available_days_after?: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveTypeBalance {
  leave_type: LeaveType | string;
  is_enforced: boolean;
  allocated_days: number | null;
  used_days: number;
  pending_days: number;
  available_days: number | null;
  is_override: boolean;
}

export interface EmployeeLeaveBalanceSummary {
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  department: string | null;
  year: number;
  balances: LeaveTypeBalance[];
}

export interface LeaveEntitlementDefault {
  id: number;
  year: number;
  leave_type: string;
  allocated_days: number;
  created_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeLeaveEntitlement {
  id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  department?: string | null;
  year: number;
  leave_type: string;
  allocated_days: number;
  created_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalanceLedgerItem {
  id: number;
  leave_request_id: number;
  employee_id: number;
  year: number;
  leave_type: string;
  transaction_type: string;
  days: number;
  created_by_user_id?: number | null;
  created_at: string;
}

export interface LeaveRequestCreatePayload {
  start_date: string;
  end_date: string;
  leave_type: LeaveType | string;
  reason?: string;
  employee_id?: number;
  optional_holiday_dates?: string[];
}

export interface LeaveRequestReviewPayload {
  decision: 'APPROVED' | 'REJECTED';
  decision_notes?: string;
}

export interface LeaveRequestListResponse {
  items: LeaveRequestDetail[];
  total: number;
  limit: number;
  offset: number;
  department?: string | null;
}

export interface LeaveFilterParams {
  employee_id?: number;
  department?: string;
  status?: string;
  leave_type?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}
