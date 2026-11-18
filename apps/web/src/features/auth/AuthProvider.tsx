import type { Me } from '@almanach/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from '../../lib/api.ts';
import { SessionExpiredDialog } from './SessionExpiredDialog.tsx';

type AuthState = { status: 'loading' } | { status: 'anonymous' } | { status: 'signed-in'; me: Me };

interface AuthValue {
  state: AuthState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Holds the signed-in person; when the session expires mid-task it asks for the password in a dialog
 * instead of navigating away, so whatever was being typed stays on screen (S-018)
 *
 * @param props {{ children: ReactNode }} - application tree
 * @returns {JSX.Element} - the provider
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'signed-in', me: await api<Me>('/api/auth/me') });
    } catch {
      setState({ status: 'anonymous' });
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState({ status: 'anonymous' });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const value = useMemo(() => ({ state, refresh, logout }), [state, refresh, logout]);
  const email = state.status === 'signed-in' ? state.me.email : '';

  return (
    <AuthContext.Provider value={value}>
      {children}
      {expired && state.status === 'signed-in' && (
        <SessionExpiredDialog
          email={email}
          onSignedIn={() => {
            setExpired(false);
            void refresh();
          }}
          onLeave={() => {
            setExpired(false);
            setState({ status: 'anonymous' });
          }}
        />
      )}
    </AuthContext.Provider>
  );
}

/**
 * Reads the authentication context
 *
 * @returns {AuthValue} - auth state and actions
 */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/**
 * Returns the signed-in person; only call inside routes guarded by RequireAuth
 *
 * @returns {Me} - the person
 */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'signed-in') throw new Error('useMe called without a session');
  return state.me;
}
