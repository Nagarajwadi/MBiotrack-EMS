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
 * Evaluates whether the user's role permits viewing the security and compliance audit trail.
 * Strictly permitted for ADMIN only. Prohibited for MANAGER and EMPLOYEE.
 */
export function canViewAuditTrail(role?: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Evaluates whether the user has a linked staff employee record allowing personal profile access.
 * Available for any authenticated user whose employee_id is non-null.
 */
export function canViewOwnProfile(user: User | null): boolean {
  return user !== null && user.employee_id !== null;
}

/**
 * Evaluates whether the user's role permits managing office locations (create, edit, deactivate).
 * Strictly permitted for ADMIN only.
 */
export function canManageOffices(role?: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Evaluates whether the user's role permits managing biometric terminal devices (create, edit, deactivate, decommission).
 * Strictly permitted for ADMIN only.
 */
export function canManageDevices(role?: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Evaluates whether the user's role permits creating employee office assignments.
 * Permitted for ADMIN and MANAGER.
 */
export function canCreateAssignment(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits deleting employee office assignments.
 * Strictly permitted for ADMIN only.
 */
export function canDeleteAssignment(role?: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Evaluates whether the user's role permits accessing the Offices & Devices administration view.
 * Permitted for ADMIN and MANAGER.
 */
export function canViewManagement(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits reviewing, approving, or rejecting leave requests.
 * Permitted for ADMIN and MANAGER.
 */
export function canReviewLeave(role?: UserRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

/**
 * Evaluates whether the user's role permits creating, editing, and deleting holiday calendar entries.
 * Strictly permitted for ADMIN only.
 */
export function canManageHolidays(role?: UserRole): boolean {
  return role === 'ADMIN';
}
