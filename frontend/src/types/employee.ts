export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  designation: string;
  joining_date: string; // ISO date format YYYY-MM-DD
  is_active: boolean;
}

export interface EmployeeCreatePayload {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  designation: string;
  joining_date: string;
  is_active?: boolean;
}

export interface EmployeeUpdatePayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  department?: string;
  designation?: string;
  joining_date?: string;
  is_active?: boolean;
}

export interface HealthCheckResponse {
  status: string;
  application: string;
}

export { ApiError, type ApiValidationError } from '../api/apiError';

