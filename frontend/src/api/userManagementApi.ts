import { apiFetch } from './client';
import type {
  PasswordResetPayload,
  UserAccount,
  UserCreatePayload,
  UserStatusUpdatePayload,
} from '../types/userManagement';

const BASE_URL = '/api/v1/users';

export async function getUsers(params?: {
  is_active?: boolean;
  role?: string;
}): Promise<UserAccount[]> {
  const searchParams = new URLSearchParams();
  if (params?.is_active !== undefined) {
    searchParams.set('is_active', String(params.is_active));
  }
  if (params?.role) {
    searchParams.set('role', params.role);
  }
  const queryString = searchParams.toString();
  const url = queryString ? `${BASE_URL}?${queryString}` : BASE_URL;

  return apiFetch<UserAccount[]>(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}

export async function createUser(payload: UserCreatePayload): Promise<UserAccount> {
  return apiFetch<UserAccount>(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateUserStatus(
  userId: number,
  payload: UserStatusUpdatePayload
): Promise<UserAccount> {
  return apiFetch<UserAccount>(`${BASE_URL}/${userId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function resetUserPassword(
  userId: number,
  payload: PasswordResetPayload
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`${BASE_URL}/${userId}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
