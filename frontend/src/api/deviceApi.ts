import { apiFetch } from './client';
import type {
  Device,
  DeviceCreatePayload,
  DeviceUpdatePayload,
} from '../types/device';

const BASE_URL = '/api/v1/devices';

export interface DeviceFilterParams {
  office_id?: number;
  status?: string;
  active_only?: boolean;
}

export async function getDevices(params?: DeviceFilterParams): Promise<Device[]> {
  const query = new URLSearchParams();
  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.status && params.status !== 'ALL') {
    query.set('status', params.status);
  }
  if (params?.active_only) {
    query.set('active_only', 'true');
  }

  const qs = query.toString();
  const url = qs ? `${BASE_URL}?${qs}` : BASE_URL;

  return apiFetch<Device[]>(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function getDevice(id: number): Promise<Device> {
  return apiFetch<Device>(`${BASE_URL}/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createDevice(payload: DeviceCreatePayload): Promise<Device> {
  return apiFetch<Device>(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateDevice(
  id: number,
  payload: DeviceUpdatePayload
): Promise<Device> {
  return apiFetch<Device>(`${BASE_URL}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function decommissionDevice(id: number): Promise<Device> {
  return apiFetch<Device>(`${BASE_URL}/${id}/decommission`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function deactivateDevice(id: number): Promise<Device> {
  return apiFetch<Device>(`${BASE_URL}/${id}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  });
}
