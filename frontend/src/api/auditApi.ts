import { apiFetch } from './client';
import type { AuditLogFilterParams, AuditLogListResponse } from '../types/audit';

const AUDIT_BASE = '/api/v1/audit-logs';

export async function getAuditLogs(
  params?: AuditLogFilterParams
): Promise<AuditLogListResponse> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    query.set('offset', String(params.offset));
  }
  if (params?.action && params.action.trim()) {
    query.set('action', params.action.trim());
  }
  if (params?.target_type && params.target_type.trim()) {
    query.set('target_type', params.target_type.trim());
  }
  if (params?.actor_user_id !== undefined) {
    query.set('actor_user_id', String(params.actor_user_id));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${AUDIT_BASE}?${queryString}` : AUDIT_BASE;

  return apiFetch<AuditLogListResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}
