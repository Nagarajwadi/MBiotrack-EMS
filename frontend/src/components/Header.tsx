import React from 'react';
import type { User } from '../types/auth';
import {
  canManageUsers,
  canViewDirectory,
  canViewManagement,
  canViewOwnProfile,
  canViewTeamAttendance,
} from '../utils/permissions';
import './components.css';

export type BackendStatus = 'checking' | 'online' | 'offline';
export type ActiveView =
  | 'directory'
  | 'profile'
  | 'attendance'
  | 'management'
  | 'leaves'
  | 'dashboard'
  | 'team-attendance'
  | 'users';

export interface HeaderProps {
  status: BackendStatus;
  user?: User | null;
  onLogout?: () => void;
  isLoggingOut?: boolean;
  activeView?: ActiveView;
  onNavigate?: (view: ActiveView) => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  user,
  onLogout,
  isLoggingOut = false,
  activeView = 'directory',
  onNavigate,
}) => {
  const getStatusDetails = () => {
    switch (status) {
      case 'online':
        return {
          label: 'Backend Online',
          className: 'status-online',
          ariaLabel: 'Backend service is online and healthy',
        };
      case 'offline':
        return {
          label: 'Backend Offline',
          className: 'status-offline',
          ariaLabel: 'Backend service is offline or unreachable',
        };
      case 'checking':
      default:
        return {
          label: 'Checking Status...',
          className: 'status-checking',
          ariaLabel: 'Checking backend service status',
        };
    }
  };

  const statusInfo = getStatusDetails();
  const hasDirectoryAccess = user ? canViewDirectory(user.role) : false;
  const hasProfileAccess = user ? canViewOwnProfile(user) : false;
  const hasManagementAccess = user ? canViewManagement(user.role) : false;
  const hasTeamAttendanceAccess = user ? canViewTeamAttendance(user.role) : false;
  const hasUserManagementAccess = user ? canManageUsers(user.role) : false;
  const isAdmin = user?.role === 'ADMIN';
  const showNavTabs = user && (isAdmin || hasDirectoryAccess);

  return (
    <header className="mbiotrack-header" role="banner">
      <div className="mbiotrack-header-container">
        <div className="mbiotrack-branding">
          <div className="mbiotrack-logo-icon" aria-hidden="true">
            M
          </div>
          <div className="mbiotrack-title-group">
            <h1>MBiotrack-EMS</h1>
            <p>Employee Management System</p>
          </div>
        </div>

        {showNavTabs && (
          <nav className="header-nav-tabs" aria-label="Main navigation">
            {hasDirectoryAccess && (
              <button
                type="button"
                className={`nav-tab-btn ${activeView === 'directory' ? 'active' : ''}`}
                onClick={() => onNavigate && onNavigate('directory')}
                aria-current={activeView === 'directory' ? 'page' : undefined}
              >
                Employee Directory
              </button>
            )}
            {hasTeamAttendanceAccess && (
              <button
                type="button"
                className={`nav-tab-btn ${activeView === 'team-attendance' ? 'active' : ''}`}
                onClick={() => onNavigate && onNavigate('team-attendance')}
                aria-current={activeView === 'team-attendance' ? 'page' : undefined}
              >
                Team Attendance
              </button>
            )}
            <button
              type="button"
              className={`nav-tab-btn ${activeView === 'attendance' ? 'active' : ''}`}
              onClick={() => onNavigate && onNavigate('attendance')}
              aria-current={activeView === 'attendance' ? 'page' : undefined}
            >
              Attendance
            </button>
            <button
              type="button"
              className={`nav-tab-btn ${activeView === 'leaves' ? 'active' : ''}`}
              onClick={() => onNavigate && onNavigate('leaves')}
              aria-current={activeView === 'leaves' ? 'page' : undefined}
            >
              Leaves & Holidays
            </button>
            {hasManagementAccess && (
              <button
                type="button"
                className={`nav-tab-btn ${activeView === 'management' ? 'active' : ''}`}
                onClick={() => onNavigate && onNavigate('management')}
                aria-current={activeView === 'management' ? 'page' : undefined}
              >
                Offices & Devices
              </button>
            )}
            {hasUserManagementAccess && (
              <button
                type="button"
                className={`nav-tab-btn ${activeView === 'users' ? 'active' : ''}`}
                onClick={() => onNavigate && onNavigate('users')}
                aria-current={activeView === 'users' ? 'page' : undefined}
              >
                User Accounts
              </button>
            )}
            {hasProfileAccess && (
              <button
                type="button"
                className={`nav-tab-btn ${activeView === 'profile' ? 'active' : ''}`}
                onClick={() => onNavigate && onNavigate('profile')}
                aria-current={activeView === 'profile' ? 'page' : undefined}
              >
                My Profile
              </button>
            )}
          </nav>
        )}

        <div className="header-controls">
          <div
            className={`mbiotrack-status-pill ${statusInfo.className}`}
            role="status"
            aria-label={statusInfo.ariaLabel}
          >
            <span className="mbiotrack-status-dot" aria-hidden="true" />
            <span>{statusInfo.label}</span>
          </div>

          {user && (
            <div className="user-profile-widget">
              <div className="user-info">
                <span className="user-name">{user.full_name}</span>
                <span className={`user-role-badge role-${user.role.toLowerCase()}`}>
                  {user.role}
                </span>
              </div>
              {onLogout && (
                <button
                  type="button"
                  className="btn btn-secondary btn-logout"
                  onClick={onLogout}
                  disabled={isLoggingOut}
                  title="Sign out on this device"
                >
                  {isLoggingOut ? 'Signing out...' : 'Sign Out'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
