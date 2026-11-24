import type { UserRole } from './auth';

export interface UserAccount {
  id: number;
  employee_id: number | null;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  employee_code?: string | null;
  department?: string | null;
  employee_is_active?: boolean | null;
}

export interface UserCreatePayload {
  employee_id: number;
  role: 'EMPLOYEE' | 'MANAGER';
  initial_password: string;
  email?: string | null;
}

export interface UserStatusUpdatePayload {
  is_active: boolean;
}

export interface UserRoleUpdatePayload {
  role: 'EMPLOYEE' | 'MANAGER';
}

export interface PasswordResetPayload {
  new_password: string;
}
