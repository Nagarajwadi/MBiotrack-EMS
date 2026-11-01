import type { User, UserRole } from '../types/auth';

/**
 * Evaluates whether the user's role permits viewing the company-wide employee directory.
 * Permitted for ADMIN and MANAGER. Strictly prohibited for EMPLOYEE.
 */
export function canViewDirectory(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits creating new employee records.
 * Permitted for ADMIN and MANAGER. Strictly prohibited for EMPLOYEE.
 */
export function canCreateEmployee(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits editing any employee in the directory.
 * Permitted for ADMIN and MANAGER.
 */
export function canEditAnyEmployee(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits deactivating / soft-deleting employees.
 * Strictly permitted for ADMIN only. Prohibited for MANAGER and EMPLOYEE.
 */
export function canDeactivateEmployee(role?: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Evaluates whether the user has a linked staff employee record allowing personal profile access.
 * Available for any authenticated user whose employee_id is non-null.
 */
export function canViewOwnProfile(user: User | null): boolean {
  return user !== null && user.employee_id !== null;
}

