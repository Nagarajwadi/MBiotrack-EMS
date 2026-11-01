import type { LoginCredentials, TokenResponse, User } from '../../types/auth';

export const mockAdminUser: User = {
  id: 1,
  employee_id: 1,
  full_name: 'Alice Admin',
  email: 'admin@mbiotrack.local',
  role: 'ADMIN',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockUnlinkedAdminUser: User = {
  id: 2,
  employee_id: null,
  full_name: 'Bootstrap Admin',
  email: 'bootstrap@mbiotrack.local',
  role: 'ADMIN',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockManagerUser: User = {
  id: 3,
  employee_id: 2,
  full_name: 'Bob Manager',
  email: 'manager@mbiotrack.local',
  role: 'MANAGER',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockEmployeeUser: User = {
  id: 4,
  employee_id: 3,
  full_name: 'Charlie Employee',
  email: 'employee@mbiotrack.local',
  role: 'EMPLOYEE',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockUnlinkedEmployeeUser: User = {
  id: 5,
  employee_id: null,
  full_name: 'Unlinked Employee',
  email: 'unlinked@mbiotrack.local',
  role: 'EMPLOYEE',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockInactiveUser: User = {
  id: 6,
  employee_id: 4,
  full_name: 'Deactivated User',
  email: 'inactive@mbiotrack.local',
  role: 'EMPLOYEE',
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const mockTokenResponse: TokenResponse = {
  access_token: 'mock-valid-access-token-jwt-12345',
  token_type: 'bearer',
  expires_in: 3600,
};

export const mockLoginCredentials: LoginCredentials = {
  email: 'admin@mbiotrack.local',
  password: 'ValidPassword123!',
};

