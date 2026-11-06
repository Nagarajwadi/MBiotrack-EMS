import { apiFetch } from './client';
import type {
  Office,
  OfficeCreatePayload,
  OfficeUpdatePayload,
} from '../types/office';

const BASE_URL = '/api/v1/offices';

export async function getOffices(activeOnly = false): Promise<Office[]> {
  const url = activeOnly ? `${BASE_URL}?active_only=true` : BASE_URL;
  return apiFetch<Office[]>(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getOffice(id: number): Promise<Office> {
  return apiFetch<Office>(`${BASE_URL}/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createOffice(payload: OfficeCreatePayload): Promise<Office> {
  return apiFetch<Office>(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateOffice(
  id: number,
  payload: OfficeUpdatePayload
): Promise<Office> {
  return apiFetch<Office>(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deactivateOffice(id: number): Promise<Office> {
  return apiFetch<Office>(`${BASE_URL}/${id}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });
}
