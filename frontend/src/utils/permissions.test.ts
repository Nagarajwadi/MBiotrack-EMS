import { describe, expect, it } from 'vitest';
import {
  canCreateEmployee,
  canDeactivateEmployee,
  canEditAnyEmployee,
  canViewDirectory,
  canViewOwnProfile,
} from './permissions';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
  mockUnlinkedAdminUser,
  mockUnlinkedEmployeeUser,
} from '../test/fixtures/authFixtures';
import type { UserRole } from '../types/auth';

describe('permissions utilities', () => {
  describe('canViewDirectory', () => {
    it('allows ADMIN to view directory', () => {
      expect(canViewDirectory('ADMIN')).toBe(true);
    });

    it('allows MANAGER to view directory', () => {
      expect(canViewDirectory('MANAGER')).toBe(true);
    });

    it('strictly forbids EMPLOYEE from viewing directory', () => {
      expect(canViewDirectory('EMPLOYEE')).toBe(false);
    });

    it('returns false for undefined or invalid role', () => {
      expect(canViewDirectory(undefined)).toBe(false);
      expect(canViewDirectory('GUEST' as unknown as UserRole)).toBe(false);
    });
  });

  describe('canCreateEmployee', () => {
    it('allows ADMIN to create employees', () => {
      expect(canCreateEmployee('ADMIN')).toBe(true);
    });

    it('allows MANAGER to create employees', () => {
      expect(canCreateEmployee('MANAGER')).toBe(true);
    });

    it('strictly forbids EMPLOYEE from creating employees', () => {
      expect(canCreateEmployee('EMPLOYEE')).toBe(false);
    });

    it('returns false for undefined or invalid role', () => {
      expect(canCreateEmployee(undefined)).toBe(false);
      expect(canCreateEmployee('ANONYMOUS' as unknown as UserRole)).toBe(false);
    });
  });

  describe('canEditAnyEmployee', () => {
    it('allows ADMIN to edit any employee', () => {
      expect(canEditAnyEmployee('ADMIN')).toBe(true);
    });

    it('allows MANAGER to edit any employee', () => {
      expect(canEditAnyEmployee('MANAGER')).toBe(true);
    });

    it('strictly forbids EMPLOYEE from editing arbitrary employees', () => {
      expect(canEditAnyEmployee('EMPLOYEE')).toBe(false);
    });

    it('returns false for undefined role', () => {
      expect(canEditAnyEmployee(undefined)).toBe(false);
    });
  });

  describe('canDeactivateEmployee', () => {
    it('allows ADMIN to deactivate employees', () => {
      expect(canDeactivateEmployee('ADMIN')).toBe(true);
    });

    it('strictly forbids MANAGER from deactivating employees', () => {
      expect(canDeactivateEmployee('MANAGER')).toBe(false);
    });

    it('strictly forbids EMPLOYEE from deactivating employees', () => {
      expect(canDeactivateEmployee('EMPLOYEE')).toBe(false);
    });

    it('returns false for undefined role', () => {
      expect(canDeactivateEmployee(undefined)).toBe(false);
    });
  });

  describe('canViewOwnProfile', () => {
    it('returns true when user has a linked staff employee_id', () => {
      expect(canViewOwnProfile(mockAdminUser)).toBe(true);
      expect(canViewOwnProfile(mockManagerUser)).toBe(true);
      expect(canViewOwnProfile(mockEmployeeUser)).toBe(true);
    });

    it('returns false when user is not linked to an employee_id (null)', () => {
      expect(canViewOwnProfile(mockUnlinkedAdminUser)).toBe(false);
      expect(canViewOwnProfile(mockUnlinkedEmployeeUser)).toBe(false);
    });

    it('returns false when user is null', () => {
      expect(canViewOwnProfile(null)).toBe(false);
    });
  });
});

