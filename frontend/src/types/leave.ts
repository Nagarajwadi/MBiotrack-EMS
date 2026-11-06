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
  decision_by_user_id: number | null;
  decision_by_user_name: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveRequestCreatePayload {
  start_date: string;
  end_date: string;
  leave_type: LeaveType | string;
  reason?: string;
  employee_id?: number;
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
}

export interface LeaveFilterParams {
  employee_id?: number;
  status?: string;
  leave_type?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}
