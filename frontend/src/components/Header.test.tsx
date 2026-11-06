import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import {
  mockAdminUser,
  mockEmployeeUser,
  mockManagerUser,
  mockUnlinkedAdminUser,
} from '../test/fixtures/authFixtures';

describe('Header component', () => {
  const mockLogout = vi.fn();
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders branding and backend status indicator', () => {
    render(<Header status="online" />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /mbiotrack-ems/i })).toBeInTheDocument();
    expect(screen.getByText('Backend Online')).toBeInTheDocument();
  });

  it('renders user details, role badge, and Sign Out button when authenticated', async () => {
    const user = userEvent.setup();
    render(
      <Header
        status="online"
        user={mockAdminUser}
        onLogout={mockLogout}
      />
    );

    expect(screen.getByText(mockAdminUser.full_name)).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();

    const logoutBtn = screen.getByRole('button', { name: /sign out/i });
    expect(logoutBtn).toBeInTheDocument();

    await user.click(logoutBtn);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  describe('Role-based navigation tabs in Header', () => {
    it('renders navigation tabs for ADMIN with a linked employee profile', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockAdminUser}
          activeView="directory"
          onNavigate={mockNavigate}
        />
      );

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toBeInTheDocument();

      const dirBtn = screen.getByRole('button', { name: /employee directory/i });
      const profileBtn = screen.getByRole('button', { name: /my profile/i });

      expect(dirBtn).toHaveAttribute('aria-current', 'page');
      expect(profileBtn).not.toHaveAttribute('aria-current');

      await user.click(profileBtn);
      expect(mockNavigate).toHaveBeenCalledWith('profile');
    });

    it('allows navigating to attendance tab for dual-access users', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockAdminUser}
          activeView="directory"
          onNavigate={mockNavigate}
        />
      );

      const attendanceBtn = screen.getByRole('button', { name: /^attendance$/i });
      expect(attendanceBtn).toBeInTheDocument();
      expect(attendanceBtn).not.toHaveAttribute('aria-current');

      await user.click(attendanceBtn);
      expect(mockNavigate).toHaveBeenCalledWith('attendance');
    });

    it('allows navigating to offices & devices tab for dual-access users', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockAdminUser}
          activeView="directory"
          onNavigate={mockNavigate}
        />
      );

      const mgmtBtn = screen.getByRole('button', { name: /offices & devices/i });
      expect(mgmtBtn).toBeInTheDocument();
      expect(mgmtBtn).not.toHaveAttribute('aria-current');

      await user.click(mgmtBtn);
      expect(mockNavigate).toHaveBeenCalledWith('management');
    });

    it('allows navigating to leaves & holidays tab for dual-access users', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockAdminUser}
          activeView="directory"
          onNavigate={mockNavigate}
        />
      );

      const leavesBtn = screen.getByRole('button', { name: /leaves & holidays/i });
      expect(leavesBtn).toBeInTheDocument();
      expect(leavesBtn).not.toHaveAttribute('aria-current');

      await user.click(leavesBtn);
      expect(mockNavigate).toHaveBeenCalledWith('leaves');
    });

    it('renders navigation tabs for MANAGER with a linked employee profile', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockManagerUser}
          activeView="profile"
          onNavigate={mockNavigate}
        />
      );

      const dirBtn = screen.getByRole('button', { name: /employee directory/i });
      const profileBtn = screen.getByRole('button', { name: /my profile/i });

      expect(profileBtn).toHaveAttribute('aria-current', 'page');
      expect(dirBtn).not.toHaveAttribute('aria-current');

      await user.click(dirBtn);
      expect(mockNavigate).toHaveBeenCalledWith('directory');
    });

    it('renders management and directory navigation for unlinked ADMIN while omitting profile', async () => {
      const user = userEvent.setup();
      render(
        <Header
          status="online"
          user={mockUnlinkedAdminUser}
          activeView="directory"
          onNavigate={mockNavigate}
        />
      );

      const nav = screen.getByRole('navigation', { name: /main navigation/i });
      expect(nav).toBeInTheDocument();

      const dirBtn = screen.getByRole('button', { name: /employee directory/i });
      const attendanceBtn = screen.getByRole('button', { name: /^attendance$/i });
      const mgmtBtn = screen.getByRole('button', { name: /offices & devices/i });
      const profileBtn = screen.queryByRole('button', { name: /my profile/i });

      expect(dirBtn).toBeInTheDocument();
      expect(attendanceBtn).toBeInTheDocument();
      expect(mgmtBtn).toBeInTheDocument();
      // Unlinked ADMIN has employee_id === null; profile navigation must be strictly omitted
      expect(profileBtn).not.toBeInTheDocument();

      await user.click(mgmtBtn);
      expect(mockNavigate).toHaveBeenCalledWith('management');
    });

    it('OMITS navigation tabs for EMPLOYEE (only has profile view)', () => {
      render(
        <Header
          status="online"
          user={mockEmployeeUser}
          activeView="profile"
          onNavigate={mockNavigate}
        />
      );

      expect(screen.queryByRole('navigation', { name: /main navigation/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /employee directory/i })).not.toBeInTheDocument();
    });
  });
});
