import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { AuthContext } from '../context/authContextDef';
import type { AuthContextValue, User } from '../types/auth';

export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  authValue?: Partial<AuthContextValue>;
  user?: User | null;
}

export function createMockAuthContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user !== undefined ? overrides.user : null;
  return {
    user,
    status: overrides.status || (user ? 'authenticated' : 'unauthenticated'),
    isAuthenticated:
      overrides.isAuthenticated !== undefined ? overrides.isAuthenticated : user !== null,
    sessionEpoch: overrides.sessionEpoch !== undefined ? overrides.sessionEpoch : 0,
    login: overrides.login || vi.fn().mockResolvedValue(undefined),
    logout: overrides.logout || vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function renderWithAuth(ui: ReactElement, options: CustomRenderOptions = {}) {
  const { authValue, user, ...renderOptions } = options;
  const resolvedAuth = createMockAuthContext({
    ...(user !== undefined ? { user } : {}),
    ...authValue,
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={resolvedAuth}>{children}</AuthContext.Provider>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    authContext: resolvedAuth,
  };
}

