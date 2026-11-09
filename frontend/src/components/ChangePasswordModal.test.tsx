import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordModal } from './ChangePasswordModal';
import * as authApi from '../api/authApi';
import { ApiError } from '../api/apiError';

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ChangePasswordModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders all fields and labels when open', () => {
    render(<ChangePasswordModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /Change Password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Current Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm New Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Password/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('validates required current password', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Please enter your current password/i);
  });

  it('validates minimum 12 characters for new password', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal isOpen={true} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/Current Password/i), 'OldPass123456!');
    await user.type(screen.getByLabelText(/^New Password/i), 'Short1!');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'Short1!');

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters long/i);
  });

  it('validates password confirmation match', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal isOpen={true} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/Current Password/i), 'OldPass123456!');
    await user.type(screen.getByLabelText(/^New Password/i), 'ValidPass123456!');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'DifferentPass123!');

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('calls changePassword and triggers onSuccess and onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const changeSpy = vi.spyOn(authApi, 'changePassword').mockResolvedValue({
      message: 'Password changed successfully.',
    });

    render(
      <ChangePasswordModal isOpen={true} onClose={onClose} onSuccess={onSuccess} />
    );

    await user.type(screen.getByLabelText(/Current Password/i), 'OldPass123456!');
    await user.type(screen.getByLabelText(/^New Password/i), 'ValidPass123456!');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'ValidPass123456!');

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    await waitFor(() => {
      expect(changeSpy).toHaveBeenCalledWith({
        current_password: 'OldPass123456!',
        new_password: 'ValidPass123456!',
      });
      expect(onSuccess).toHaveBeenCalledWith('Password changed successfully.');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays API error on failed password change and preserves state without closing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    vi.spyOn(authApi, 'changePassword').mockRejectedValue(
      new ApiError(400, 'Incorrect current password.')
    );

    render(<ChangePasswordModal isOpen={true} onClose={onClose} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/Current Password/i), 'WrongPass1234!');
    await user.type(screen.getByLabelText(/^New Password/i), 'ValidPass123456!');
    await user.type(screen.getByLabelText(/Confirm New Password/i), 'ValidPass123456!');

    await user.click(screen.getByRole('button', { name: /Update Password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect current password.');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
