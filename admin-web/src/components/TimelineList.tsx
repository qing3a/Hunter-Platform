import { useState } from 'react';
import AuditJsonDrawer from './AuditJsonDrawer';
import { relativeTime } from '@hunter-platform/shared-web/lib';
import type { TimelineItem } from '../api/timeline';

const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
  admin:  { bg: '#e6f7ff', fg: '#1890ff' },
  user:   { bg: '#f6ffed', fg: '#52c41a' },
  unlock: { bg: '#fff7e6', fg: '#fa8c16' },
};

type TimelineListProps = {
  items: TimelineItem[];
  loading: boolean;
  empty: string;
};

export default function TimelineList({ items, loading, empty }: TimelineListProps) {
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; data: unknown }>({
    open: false, title: '', data: null,
  });

  if (loading) return <div>加载中...</div>;
  if (items.length === 0) return <div className="card">{empty}</div>;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => {
          const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.admin;
          return (
            <div
              key={`${item.source}-${item.id}`}
              data-testid={`timeline-item-${item.id}`}
              style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 4, padding: 12 }}
            >
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                {relativeTime(item.created_at)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  data-testid={`timeline-source-${item.source}`}
                  style={{
                    background: color.bg, color: color.fg,
                    padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                  }}
                >
                  {item.source}
                </span>
                <code style={{ fontSize: 14 }}>{item.action}</code>
              </div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                操作人: {item.actor ?? '—'}
              </div>
              {item.details && (
                <button
                  className="btn btn-sm"
                  data-testid={`timeline-detail-${item.id}`}
                  onClick={() => setDrawer({
                    open: true,
                    title: `${item.action} @ ${item.created_at}`,
                    data: item.details,
                  })}
                >
                  查看 JSON 详情
                </button>
              )}
            </div>
          );
        })}
      </div>
      <AuditJsonDrawer
        open={drawer.open}
        title={drawer.title}
        json={typeof drawer.data === 'string' ? drawer.data : null}
        onClose={() => setDrawer({ open: false, title: '', data: null })}
      />
    </>
  );
}