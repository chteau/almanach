import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

/**
 * Asks for confirmation before leaving a page with unsaved changes (section 8), for in-app
 * navigation and for closing or reloading the tab
 *
 * @param dirty {boolean} - whether the form has unsaved changes
 * @param message {string} - confirmation text
 * @returns {() => void} - call right before navigating away after a successful save
 */
export function useUnsavedGuard(dirty: boolean, message: string): () => void {
  const saved = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !saved.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return useCallback(() => {
    saved.current = true;
  }, []);
}
