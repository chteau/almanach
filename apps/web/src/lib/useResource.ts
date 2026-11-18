import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads a JSON resource and exposes loading, error and reload for the page states of section 8
 *
 * @param path {string | null} - API path, or null to skip loading
 * @returns {Resource<T>} - current data, error, loading flag and a reload function
 */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the reload trigger
  useEffect(() => {
    if (path === null) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    api<T>(path)
      .then((result) => active && setData(result))
      .catch((failure: unknown) => active && setError(failure))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, error, loading, reload };
}
