import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { StatusScreen } from '../../components/StatusScreen/StatusScreen.tsx';
import { useAuth } from './AuthProvider.tsx';

/**
 * Renders children only for a signed-in person, otherwise sends them to sign-in and back afterwards
 *
 * @param props {{ children: ReactNode; onboarded?: boolean }} - protected content; onboarded tells whether the profile must exist
 * @returns {JSX.Element} - the content, a redirect or a loading screen
 */
export function RequireAuth({ children, onboarded = true }: { children: ReactNode; onboarded?: boolean }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <StatusScreen state="loading" />;
  if (state.status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (onboarded && !state.me.onboarded) return <Navigate to="/onboarding" replace />;
  if (!onboarded && state.me.onboarded) return <Navigate to="/" replace />;
  return children;
}
