import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * useAsync — runs an async function with a guaranteed `loading` flag and
 * `error` capture. Eliminates the "page stuck on spinner" class of bugs
 * caused by `setLoading(true)` without a matching `setLoading(false)` in
 * a catch branch.
 *
 * Usage:
 *   const { data, loading, error, refresh } = useAsync(() => api.listLeads(), []);
 *
 * Options:
 *   - silentError: don't toast on failure (background polls, optional fetches)
 *   - errorMessage: override the toast text
 */
export interface UseAsyncOptions {
  silentError?: boolean;
  errorMessage?: string;
  immediate?: boolean;          // default true — run on mount
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = [],
  options: UseAsyncOptions = {},
) {
  const { silentError = false, errorMessage, immediate = true } = options;
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError]     = useState<Error | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (mounted.current) setData(result);
      return result;
    } catch (e: any) {
      if (mounted.current) setError(e);
      // Axios interceptor already toasts mutation errors; this hook is for
      // reads, where a silent fallback to "—" or empty list is usually OK.
      // Show a toast only if the caller asked us to OR we know the
      // interceptor stayed quiet (silent: true means caller is handling it).
      if (!silentError && !(e?.config?.headers?.['X-Silent'] === '1')) {
        // The axios interceptor already toasted for non-401/403/410 errors,
        // so suppress here unless the caller explicitly asked for a custom
        // message.
        if (errorMessage) toast.error(errorMessage);
      }
      throw e;
    } finally {
      if (mounted.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) refresh().catch(() => {/* already handled */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refresh, setData };
}

/**
 * useAsyncAction — wrap a one-shot action (button click, form submit) with
 * guaranteed busy state and error toast. Returns a callable + busy flag.
 *
 * Usage:
 *   const [save, saving] = useAsyncAction(async () => {
 *     await api.updateLead(id, body);
 *     toast.success('Saved');
 *   });
 *
 *   <button onClick={save} disabled={saving}>Save</button>
 */
export function useAsyncAction<Args extends any[], R>(
  fn: (...args: Args) => Promise<R>,
  options: { errorMessage?: string } = {},
): [(...args: Args) => Promise<R | undefined>, boolean] {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    setBusy(true);
    try {
      return await fn(...args);
    } catch (e: any) {
      // Axios interceptor toasts most errors. Show a custom message only if
      // the caller provided one and the error was not already toasted by
      // the interceptor (i.e. status 403 / 410 which it stays silent on).
      if (options.errorMessage) {
        const status = e?.response?.status;
        const wasSilent = status === 403 || status === 410;
        if (wasSilent) toast.error(options.errorMessage);
      }
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn]);

  return [run, busy];
}
