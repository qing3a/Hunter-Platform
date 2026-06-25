import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Generic single-URL-param hook. Reads/writes one search param with optional
 * parser (for type conversion) and default value.
 *
 * Returns [value, setter] tuple. Setter accepts the typed value (or null to delete).
 *
 * Replaces the per-key boilerplate in useTimelineFilters and any other
 * page that needs URL-synced filter state.
 */
export function useUrlParam<T = string>(
  key: string,
  defaultValue: T,
  parser?: (raw: string | null) => T | null,
): [T, (v: T | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(key);
  const parsed = parser ? parser(raw) : (raw === null ? null : (raw as unknown as T));
  const value: T = (parsed === null || parsed === undefined) ? defaultValue : parsed;

  const setter = useCallback(
    (v: T | null) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (v === null || v === '' || v === defaultValue) {
            next.delete(key);
          } else {
            next.set(key, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, key, defaultValue],
  );

  return [value, setter];
}
