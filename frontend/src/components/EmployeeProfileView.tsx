import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getEmployee, updateEmployee } from '../api/employeeApi';
import { ApiError } from '../api/apiError';
import type { Employee } from '../types/employee';
import type { User } from '../types/auth';
import { ProfileEditModal } from './ProfileEditModal';
import { ChangePasswordModal } from './ChangePasswordModal';
import './components.css';

export interface EmployeeProfileViewProps {
  employeeId: number;
  sessionEpoch: number;
  currentUser?: User | null;
  onProfileUpdated?: (updated: Employee) => void;
  onPasswordChanged?: (message: string) => void | Promise<void>;
}

export const EmployeeProfileView: React.FC<EmployeeProfileViewProps> = ({
  employeeId,
  sessionEpoch,
  currentUser,
  onProfileUpdated,
  onPasswordChanged,
}) => {
  const [profile, setProfile] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  // Authorization check: Employees may only view/update their own profile record
  const isUnauthorized = Boolean(
    currentUser &&
      currentUser.role === 'EMPLOYEE' &&
      currentUser.employee_id !== null &&
      currentUser.employee_id !== undefined &&
      currentUser.employee_id !== employeeId
  );

  // Auto-dismiss local feedback
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Load employee profile with sessionEpoch protection
  const reloadProfile = useCallback(async () => {
    if (isUnauthorized) {
      return;
    }

    const requestEpoch = sessionEpochRef.current;
    setIsLoading(true);
    setLoadError(null);

    try {
      const data = await getEmployee(employeeId);
      if (requestEpoch !== sessionEpochRef.current) {
        return;
      }
      setProfile(data);
    } catch (err: unknown) {
      if (requestEpoch !== sessionEpochRef.current) {
        return;
      }
      if (err instanceof ApiError) {
        setLoadError(err.message);
      } else {
        setLoadError('Unable to load employee profile from backend.');
      }
    } finally {
      if (requestEpoch === sessionEpochRef.current) {
        setIsLoading(false);
      }
    }
  }, [employeeId, isUnauthorized]);

  useEffect(() => {
    if (isUnauthorized) {
      return;
    }

    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    getEmployee(employeeId)
      .then((data) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) {
          return;
        }
        setProfile(data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) {
          return;
        }
        if (err instanceof ApiError) {
          setLoadError(err.message);
        } else {
          setLoadError('Unable to load employee profile from backend.');
        }
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [employeeId, isUnauthorized]);

  // Handle personal profile submission
  const handleProfileSubmit = async (payload: { first_name: string; last_name: string }) => {
    if (isSaving || !profile) return;
    if (isUnauthorized) {
      setServerError('Access forbidden: You may only update your own employee record.');
      return;
    }

    setIsSaving(true);
    setServerError(null);

    try {
      const updated = await updateEmployee(employeeId, payload);
      setProfile(updated);
      setIsEditModalOpen(false);
      setFeedback('Your personal details have been updated successfully.');
      if (onProfileUpdated) {
        onProfileUpdated(updated);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Failed to save profile changes. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Immediate authorization boundary render
  if (isUnauthorized) {
    return (
      <div className="profile-container">
        <div className="alert-banner error" role="alert">
          <div className="alert-content">
            <span aria-hidden="true">⚠️</span>
            <span>Access forbidden: You may only view your own employee record.</span>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="profile-container" aria-busy="true" aria-live="polite">
        <div className="table-state-container">
          <div className="table-spinner" role="progressbar" aria-label="Loading profile" />
          <div className="table-state-title">Loading Personal Profile...</div>
          <div className="table-state-description">Retrieving your staff records from the database</div>
        </div>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="profile-container">
        <div className="alert-banner error" role="alert">
          <div className="alert-content">
            <span aria-hidden="true">⚠️</span>
            <span>{loadError || 'Employee profile not found.'}</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reloadProfile()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      {feedback && (
        <div className="alert-banner success" role="status" aria-live="polite">
          <div className="alert-content">
            <span aria-hidden="true">✓</span>
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            className="alert-close"
            aria-label="Close notification"
            onClick={() => setFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="profile-card">
        {/* Profile Card Header */}
        <div className="profile-header-banner">
          <div className="profile-avatar-circle" aria-hidden="true">
            {profile.first_name.charAt(0).toUpperCase()}
            {profile.last_name.charAt(0).toUpperCase()}
          </div>
          <div className="profile-title-block">
            <h2>
              {profile.first_name} {profile.last_name}
            </h2>
            <p className="profile-subtitle">
              {profile.designation} • {profile.department}
            </p>
            <span className={`status-badge ${profile.is_active ? 'active' : 'inactive'}`}>
              {profile.is_active ? 'Active Staff' : 'Inactive'}
            </span>
          </div>

          <div className="profile-header-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsChangePasswordModalOpen(true)}
            >
              🔑 Change Password
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setServerError(null);
                setIsEditModalOpen(true);
              }}
            >
              ✏️ Edit Details
            </button>
          </div>
        </div>

        {/* Profile Information Grid */}
        <div className="profile-details-grid">
          <div className="profile-detail-item">
            <span className="detail-label">Employee Code</span>
            <span className="detail-value font-mono">{profile.employee_code}</span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Full Name</span>
            <span className="detail-value">
              {profile.first_name} {profile.last_name}
            </span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Work Email</span>
            <span className="detail-value">{profile.email}</span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Department</span>
            <span className="detail-value">{profile.department}</span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Designation</span>
            <span className="detail-value">{profile.designation}</span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Date of Joining</span>
            <span className="detail-value">
              <time dateTime={profile.joining_date}>{profile.joining_date}</time>
            </span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Employment Status</span>
            <span className="detail-value">{profile.is_active ? 'Active' : 'Inactive'}</span>
          </div>

          <div className="profile-detail-item">
            <span className="detail-label">Reporting Manager</span>
            <span className="detail-value text-muted">None assigned</span>
          </div>
        </div>

        {/* Contact Information & V1 Boundary Notice */}
        <div className="profile-contact-notice" role="note" aria-label="Contact information policy">
          <div className="contact-notice-icon" aria-hidden="true">ℹ️</div>
          <div className="contact-notice-content">
            <strong>Contact & Personal Information</strong>
            <p>
              Personal phone number, residential address, personal email, and emergency contact details
              are not stored in the V1 database schema. To update contact records or request organizational
              changes, please contact Human Resources.
            </p>
          </div>
        </div>
      </div>

      <ProfileEditModal
        isOpen={isEditModalOpen}
        employee={profile}
        isSubmitting={isSaving}
        serverError={serverError}
        onClose={() => {
          if (!isSaving) {
            setIsEditModalOpen(false);
            setServerError(null);
          }
        }}
        onSubmit={handleProfileSubmit}
      />

      <ChangePasswordModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
        onSuccess={(msg) => {
          if (onPasswordChanged) {
            void onPasswordChanged(msg);
          } else {
            setFeedback(msg);
          }
        }}
      />
    </div>
  );
};
