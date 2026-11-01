import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/useAuth';
import { ApiError } from '../api/apiError';
import './components.css';

export interface LoginFormProps {
  onLoginSuccess?: () => void;
}

export function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Rate-limit active countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          setErrorMessage(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [countdown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting || (countdown !== null && countdown > 0)) {
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({
        email: trimmedEmail,
        password,
      });
      if (onLoginSuccess) {
        onLoginSuccess();
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retrySec = err.retryAfter && err.retryAfter > 0 ? err.retryAfter : 60;
          setCountdown(retrySec);
          setErrorMessage(
            `Too many failed login attempts. Please wait ${retrySec} seconds before retrying.`
          );
        } else if (err.status === 401) {
          setErrorMessage('Invalid email or password.');
        } else if (err.status === 403) {
          setErrorMessage('Your account is inactive. Please contact an administrator.');
        } else {
          setErrorMessage(err.message || 'Authentication failed. Please try again.');
        }
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLocked = isSubmitting || (countdown !== null && countdown > 0);

  return (
    <div className="login-card-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-avatar" aria-hidden="true">
            🔐
          </div>
          <h2>Sign In to MBiotrack-EMS</h2>
          <p>Enter your credentials to access the employee management system.</p>
        </div>

        {errorMessage && (
          <div className="alert-banner error" role="alert" aria-live="polite">
            <div className="alert-content">
              <span aria-hidden="true">⚠️</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. admin@mbiotrack.local"
              required
              disabled={isLocked}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              disabled={isLocked}
              autoComplete="current-password"
            />
          </div>

          <div className="login-actions">
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={isLocked}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? 'Authenticating...'
                : countdown !== null && countdown > 0
                  ? `Locked (${countdown}s)`
                  : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
