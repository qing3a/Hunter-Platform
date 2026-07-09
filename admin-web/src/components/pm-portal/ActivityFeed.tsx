import {
  ACTIVITY_EVENT_LABELS,
  ACTIVITY_EVENT_ACCENTS,
  type ActivityEvent,
  type ActivityEventType,
} from '../../api/pm-portal';

// ============================================================================
// ActivityFeed (Task 12 / S1)
// ============================================================================
//
// Renders the HR activity feed (last 24h of events) for the Global
// Snapshot page. Each row carries:
//   - accent-colored type chip (申请 / 认领 / 匹配)
//   - pre-formatted Chinese summary (e.g. "张*三 申请了 高级前端工程师")
//   - relative timestamp (5 分钟前 / 3 小时前 / 昨天)
//   - data-testids for the page-level test to assert on
//
// Empty state: "暂无最近活动" — shown when the array is empty so the
// page never has a dangling blank section.
//
// Time formatting is intentionally simple — no date-fns dependency.
// Days / hours / minutes are sufficient for a 24h window.

interface ActivityFeedProps {
  events: ActivityEvent[];
  /** Reference "now" for relative-time computation. Defaults to Date.now().
   *  Tests pass an explicit value to keep timestamps deterministic. */
  now?: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

function formatRelativeTime(unixMs: number, now: number): string {
  const delta = now - unixMs;
  if (delta < 0) return '刚刚';
  if (delta < MIN_MS) return '刚刚';
  if (delta < HOUR_MS) {
    const mins = Math.floor(delta / MIN_MS);
    return `${mins} 分钟前`;
  }
  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    return `${hours} 小时前`;
  }
  return '昨天';
}

export function ActivityFeed({ events, now = Date.now() }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <div
        className="pm-snapshot-feed-empty"
        data-testid="pm-snapshot-feed-empty"
      >
        暂无最近活动
      </div>
    );
  }

  return (
    <ul
      className="pm-snapshot-feed"
      data-testid="pm-snapshot-feed"
      aria-label="HR 活动流"
    >
      {events.map((ev, idx) => {
        const accent = ACTIVITY_EVENT_ACCENTS[ev.event_type];
        const typeLabel = ACTIVITY_EVENT_LABELS[ev.event_type];
        const relative = formatRelativeTime(ev.occurred_at, now);
        // Build a stable React key. Activity rows don't carry a server-
        // side id so we composite one from the (type, occurred_at,
        // position_id) tuple — this is unique enough for our 24h window.
        const key = `${ev.event_type}-${ev.occurred_at}-${ev.position_id ?? 'na'}-${idx}`;
        return (
          <li
            key={key}
            className={`pm-snapshot-feed-item pm-snapshot-feed-item-${accent}`}
            data-testid="pm-snapshot-feed-item"
            data-event-type={ev.event_type}
            data-position-id={ev.position_id ?? ''}
            data-project-id={ev.project_id ?? ''}
          >
            <span
              className={`pm-snapshot-feed-chip pm-snapshot-feed-chip-${accent}`}
              data-testid="pm-snapshot-feed-chip"
            >
              {typeLabel}
            </span>
            <span
              className="pm-snapshot-feed-summary"
              data-testid="pm-snapshot-feed-summary"
            >
              {ev.summary}
            </span>
            <span
              className="pm-snapshot-feed-time"
              data-testid="pm-snapshot-feed-time"
            >
              {relative}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Re-export so tests can drive the relative-time formatter without
// re-importing the (un-exported) helper directly.
export const ACTIVITY_LABELS_FOR_TYPE: Record<ActivityEventType, string> = ACTIVITY_EVENT_LABELS;