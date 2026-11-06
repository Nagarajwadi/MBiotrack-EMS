import { apiFetch } from './client';
import type {
  AssignmentCreatePayload,
  OfficeAssignment,
} from '../types/assignment';

const BASE_URL = '/api/v1/offices/assignments';

export interface AssignmentFilterParams {
  employee_id?: number;
  office_id?: number;
}

export async function getAssignments(
  params?: AssignmentFilterParams
): Promise<OfficeAssignment[]> {
  const query = new URLSearchParams();
  if (params?.employee_id !== undefined && params.employee_id !== null) {
    query.set('employee_id', String(params.employee_id));
  }
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }

  const qs = query.toString();
  const url = qs ? `${BASE_URL}?${qs}` : BASE_URL;

  return apiFetch<OfficeAssignment[]>(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getAssignment(id: number): Promise<OfficeAssignment> {
  return apiFetch<OfficeAssignment>(`${BASE_URL}/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createAssignment(
  payload: AssignmentCreatePayload
): Promise<OfficeAssignment> {
  return apiFetch<OfficeAssignment>(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteAssignment(id: number): Promise<void> {
  return apiFetch<void>(`${BASE_URL}/${id}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });
}
