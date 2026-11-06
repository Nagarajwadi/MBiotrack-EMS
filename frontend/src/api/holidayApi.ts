import { apiFetch } from './client';
import type {
  HolidayCreatePayload,
  HolidayDetail,
  HolidayFilterParams,
  HolidayListResponse,
  HolidayUpdatePayload,
} from '../types/holiday';

const HOLIDAYS_BASE = '/api/v1/holidays';

export async function getHolidays(
  params?: HolidayFilterParams
): Promise<HolidayListResponse> {
  const query = new URLSearchParams();

  if (params?.office_id !== undefined && params.office_id !== null) {
    query.set('office_id', String(params.office_id));
  }
  if (params?.start_date && params.start_date.trim()) {
    query.set('start_date', params.start_date.trim());
  }
  if (params?.end_date && params.end_date.trim()) {
    query.set('end_date', params.end_date.trim());
  }
  if (params?.include_org_wide !== undefined) {
    query.set('include_org_wide', String(params.include_org_wide));
  }

  const queryString = query.toString();
  const endpoint = queryString ? `${HOLIDAYS_BASE}?${queryString}` : HOLIDAYS_BASE;

  return apiFetch<HolidayListResponse>(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createHoliday(
  payload: HolidayCreatePayload
): Promise<HolidayDetail> {
  return apiFetch<HolidayDetail>(HOLIDAYS_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateHoliday(
  id: number,
  payload: HolidayUpdatePayload
): Promise<HolidayDetail> {
  return apiFetch<HolidayDetail>(`${HOLIDAYS_BASE}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteHoliday(id: number): Promise<void> {
  return apiFetch<void>(`${HOLIDAYS_BASE}/${id}`, {
    method: 'DELETE',
  });
}
