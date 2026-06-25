import { useSearchParams } from 'react-router-dom';
import { useUrlParam } from './useUrlParam';

export type TimelineSource = 'all' | 'admin' | 'user' | 'unlock';
const VALID_SOURCES: TimelineSource[] = ['all', 'admin', 'user', 'unlock'];

export type TimelineFilters = {
  source: TimelineSource;
  setSource: (s: TimelineSource | null) => void;
  from: string;
  setFrom: (v: string | null) => void;
  until: string;
  setUntil: (v: string | null) => void;
  actor: string;
  setActor: (v: string | null) => void;
  page: number;
  setPage: (n: number | null) => void;
  resetAll: () => void;
};

const sourceParser = (raw: string | null): TimelineSource | null =>
  raw && (VALID_SOURCES as string[]).includes(raw) ? (raw as TimelineSource) : null;

const pageParser = (raw: string | null): number | null => {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Math.max(1, parseInt(raw, 10));
};

export function useTimelineFilters(): TimelineFilters {
  const [source, _setSource] = useUrlParam<TimelineSource>('source', 'all', sourceParser);
  const [from, setFrom] = useUrlParam<string>('from', '');
  const [until, setUntil] = useUrlParam<string>('until', '');
  const [actor, setActor] = useUrlParam<string>('actor', '');
  const [page, setPage] = useUrlParam<number>('page', 1, pageParser);
  // setSource has a side effect: reset page to 1. Use single setSearchParams
  // call to avoid React Router batching the per-key setters.
  // resetAll must also use a single setSearchParams call for the same reason.
  const [, setSearchParams] = useSearchParams();

  const setSource = (s: TimelineSource | null) => {
    if (s === null || s === 'all') {
      // clear source (and reset page)
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('source');
        next.delete('page');
        return next;
      }, { replace: true });
    } else {
      // set source (and reset page)
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('source', s);
        next.delete('page');
        return next;
      }, { replace: true });
    }
  };

  const resetAll = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('source');
      next.delete('from');
      next.delete('until');
      next.delete('actor');
      next.delete('page');
      return next;
    }, { replace: true });
  };

  return { source, setSource, from, setFrom, until, setUntil, actor, setActor, page, setPage, resetAll };
}
