export interface AuditLog {
  id: number;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditLogFilterParams {
  limit?: number;
  offset?: number;
  action?: string;
  target_type?: string;
  actor_user_id?: number;
}

