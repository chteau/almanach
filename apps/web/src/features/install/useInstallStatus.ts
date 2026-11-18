import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

export type InstallStatus = 'loading' | 'error' | 'installed' | 'not_installed';

/**
 * Fetches whether the instance is installed
 *
 * @returns {InstallStatus} - current status; 'loading' until the server answers
 */
export function useInstallStatus(): InstallStatus {
  const [status, setStatus] = useState<InstallStatus>('loading');

  useEffect(() => {
    let active = true;
    api<{ installed: boolean }>('/api/install/status')
      .then((result) => active && setStatus(result.installed ? 'installed' : 'not_installed'))
      .catch(() => active && setStatus('error'));
    return () => {
      active = false;
    };
  }, []);

  return status;
}
