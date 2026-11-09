import { apiFetch } from './client';
import type {
  Employee,
  EmployeeCreatePayload,
  EmployeeUpdatePayload,
  HealthCheckResponse,
} from '../types/employee';

const BASE_URL = '/api/v1/employees';
const HEALTH_URL = '/health';

export async function getEmployees(status?: 'ACTIVE' | 'INACTIVE' | 'ALL'): Promise<Employee[]> {
  const url = status && status !== 'ACTIVE' ? `${BASE_URL}?status=${status}` : BASE_URL;
  return apiFetch<Employee[]>(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getEmployee(id: number): Promise<Employee> {
  return apiFetch<Employee>(`${BASE_URL}/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createEmployee(payload: EmployeeCreatePayload): Promise<Employee> {
  return apiFetch<Employee>(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateEmployee(
  id: number,
  payload: EmployeeUpdatePayload
): Promise<Employee> {
  return apiFetch<Employee>(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteEmployee(id: number): Promise<void> {
  await apiFetch<void>(`${BASE_URL}/${id}`, {
    method: 'DELETE',
  });
}

export async function reactivateEmployee(id: number): Promise<Employee> {
  return apiFetch<Employee>(`${BASE_URL}/${id}/reactivate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getHealth(): Promise<HealthCheckResponse> {
  return apiFetch<HealthCheckResponse>(HEALTH_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    skipAuth: true,
  });
}
