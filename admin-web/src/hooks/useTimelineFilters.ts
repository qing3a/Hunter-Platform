import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type TimelineSource = 'all' | 'admin' | 'user' | 'unlock';
const VALID_SOURCES: TimelineSource[] = ['all', 'admin', 'user', 'unlock'];

export type TimelineFilters = {
  source: TimelineSource;
  setSource: (s: TimelineSource) => void;
  from: string;
  setFrom: (v: string) => void;
  until: string;
  setUntil: (v: string) => void;
  actor: string;
  setActor: (v: string) => void;
  page: number;
  setPage: (n: number) => void;
  resetAll: () => void;
};

/**
 * Hook for the 4 timeline pages (User/Candidate/Job/Recommendation).
 * Syncs 5 filter values (source/from/until/actor/page) with URL searchParams
 * using replace:true so filter changes don't pollute browser history.
 *
 * Default values (source='all', from='', until='', actor='', page=1) are
 * OMITTED from the URL to keep URLs clean.
 */
export function useTimelineFilters(): TimelineFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read raw values from URL with defaults
  const rawSource = searchParams.get('source') ?? '';
  const source: TimelineSource = (VALID_SOURCES as string[]).includes(rawSource)
    ? (rawSource as TimelineSource)
    : 'all';
  const from = searchParams.get('from') ?? '';
  const until = searchParams.get('until') ?? '';
  const actor = searchParams.get('actor') ?? '';
  const pageRaw = searchParams.get('page');
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, parseInt(pageRaw, 10)) : 1;

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSource = useCallback((s: TimelineSource) => {
    updateParams({ source: s === 'all' ? null : s, page: null });
  }, [updateParams]);

  const setFrom = useCallback((v: string) => {
    updateParams({ from: v || null, page: null });
  }, [updateParams]);

  const setUntil = useCallback((v: string) => {
    updateParams({ until: v || null, page: null });
  }, [updateParams]);

  const setActor = useCallback((v: string) => {
    updateParams({ actor: v || null, page: null });
  }, [updateParams]);

  const setPage = useCallback((n: number) => {
    updateParams({ page: n > 1 ? String(n) : null });
  }, [updateParams]);

  const resetAll = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  return { source, setSource, from, setFrom, until, setUntil, actor, setActor, page, setPage, resetAll };
}