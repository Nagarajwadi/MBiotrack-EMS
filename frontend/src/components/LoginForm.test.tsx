import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';
import { renderWithAuth } from '../test/renderUtils';
import { ApiError } from '../api/apiError';

describe('LoginForm component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form with accessible labels, inputs, and submit button', () => {
    renderWithAuth(<LoginForm />);

    expect(screen.getByRole('heading', { name: /sign in to mbiotrack-ems/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('validates empty email and displays an accessible error message', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn();
    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter your email address.');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('validates empty password when email is provided', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn();
    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.type(screen.getByLabelText(/email address/i), 'user@test.local');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter your password.');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('submits trimmed credentials and calls onLoginSuccess on success', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    const mockSuccess = vi.fn();

    renderWithAuth(<LoginForm onLoginSuccess={mockSuccess} />, {
      authValue: { login: mockLogin },
    });

    await user.type(screen.getByLabelText(/email address/i), '  admin@mbiotrack.local  ');
    await user.type(screen.getByLabelText(/password/i), 'SecretPass123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith({
      email: 'admin@mbiotrack.local',
      password: 'SecretPass123!',
    });
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });

  it('displays error message when authentication returns 401 Unauthorized', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockRejectedValue(new ApiError(401, 'Invalid credentials'));

    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
    await user.type(screen.getByLabelText(/password/i), 'WrongPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('displays error message when authentication returns 403 Forbidden (inactive user)', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockRejectedValue(new ApiError(403, 'Inactive account'));

    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.type(screen.getByLabelText(/email address/i), 'inactive@mbiotrack.local');
    await user.type(screen.getByLabelText(/password/i), 'ValidPassword123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account is inactive. Please contact an administrator.'
    );
  });

  it('handles rate-limiting (429) by showing countdown and disabling inputs', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockRejectedValue(
      new ApiError(429, 'Rate limited', undefined, 30)
    );

    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
    await user.type(screen.getByLabelText(/password/i), 'GuessPass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed login attempts. Please wait 30 seconds before retrying.'
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();
  });

  it('disables submit button and shows "Authenticating..." during active submission', async () => {
    const user = userEvent.setup();
    let resolveLogin: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    const mockLogin = vi.fn().mockReturnValue(pendingPromise);

    renderWithAuth(<LoginForm />, { authValue: { login: mockLogin } });

    await user.type(screen.getByLabelText(/email address/i), 'admin@mbiotrack.local');
    await user.type(screen.getByLabelText(/password/i), 'ValidPass123!');

    const submitBtn = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitBtn);

    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Authenticating...');
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');

    // Attempt second click while pending
    await user.click(submitBtn);
    expect(mockLogin).toHaveBeenCalledTimes(1);

    // Resolve login
    resolveLogin();
    await expect(pendingPromise).resolves.toBeUndefined();
  });
});

