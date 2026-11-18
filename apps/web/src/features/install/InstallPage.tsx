import { Navigate } from 'react-router';
import { StatusScreen } from '../../components/StatusScreen/StatusScreen.tsx';
import { InstallWizard } from './InstallWizard.tsx';
import { useInstallStatus } from './useInstallStatus.ts';

/**
 * Route /install: shows the wizard only while the instance is not installed
 *
 * @returns {JSX.Element} - the wizard, a redirect to sign-in, or a status screen
 */
export function InstallPage() {
  const status = useInstallStatus();
  if (status === 'loading' || status === 'error') return <StatusScreen state={status} />;
  return status === 'installed' ? <Navigate to="/login" replace /> : <InstallWizard />;
}
