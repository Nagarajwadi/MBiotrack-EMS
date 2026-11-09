import { apiFetch } from './client';
import type {
  LoginCredentials,
  LogoutResponse,
  PasswordChangePayload,
  TokenResponse,
  User,
} from '../types/auth';

const AUTH_BASE = '/api/v1/auth';

export async function login(credentials: LoginCredentials): Promise<TokenResponse> {
  return apiFetch<TokenResponse>(`${AUTH_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(credentials),
    skipAuth: true,
  });
}

export async function getCurrentUser(token?: string): Promise<User> {
  return apiFetch<User>(`${AUTH_BASE}/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    token,
  });
}

export async function logout(token?: string): Promise<LogoutResponse> {
  return apiFetch<LogoutResponse>(`${AUTH_BASE}/logout`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    token,
  });
}

export async function changePassword(payload: PasswordChangePayload): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`${AUTH_BASE}/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

