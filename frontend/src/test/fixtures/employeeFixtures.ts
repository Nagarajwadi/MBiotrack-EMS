import type {
  Employee,
  EmployeeCreatePayload,
  EmployeeUpdatePayload,
} from '../../types/employee';

export const mockEmployee1: Employee = {
  id: 1,
  employee_code: 'EMP-001',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane.doe@company.com',
  department: 'Engineering',
  designation: 'Senior Software Engineer',
  joining_date: '2025-01-15',
  is_active: true,
};

export const mockEmployee2: Employee = {
  id: 2,
  employee_code: 'EMP-002',
  first_name: 'John',
  last_name: 'Smith',
  email: 'john.smith@company.com',
  department: 'Human Resources',
  designation: 'HR Coordinator',
  joining_date: '2025-02-01',
  is_active: false,
};

export const mockEmployee3: Employee = {
  id: 3,
  employee_code: 'EMP-003',
  first_name: 'Charlie',
  last_name: 'Brown',
  email: 'charlie.brown@company.com',
  department: 'Product',
  designation: 'Product Manager',
  joining_date: '2025-03-01',
  is_active: true,
};

export const mockEmployeesList: Employee[] = [
  mockEmployee1,
  mockEmployee2,
  mockEmployee3,
];

export const mockCreatePayload: EmployeeCreatePayload = {
  employee_code: 'EMP-004',
  first_name: 'Diana',
  last_name: 'Prince',
  email: 'diana.prince@company.com',
  department: 'Security',
  designation: 'Security Specialist',
  joining_date: '2026-01-10',
  is_active: true,
};

export const mockCreatedEmployee: Employee = {
  id: 4,
  employee_code: 'EMP-004',
  first_name: 'Diana',
  last_name: 'Prince',
  email: 'diana.prince@company.com',
  department: 'Security',
  designation: 'Security Specialist',
  joining_date: '2026-01-10',
  is_active: true,
};

export const mockUpdatePayload: EmployeeUpdatePayload = {
  first_name: 'Janet',
  last_name: 'Doe',
};
