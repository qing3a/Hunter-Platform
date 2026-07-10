import { useToast } from '@hunter-platform/shared-web/lib';

const colors: Record<string, { bg: string; border: string }> = {
  success: { bg: '#e6f7ec', border: '#52c41a' },
  error:   { bg: '#fff1f0', border: '#ff4d4f' },
  info:    { bg: '#e6f7ff', border: '#1890ff' },
};

export default function Toast() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {toasts.map(t => {
        const c = colors[t.type] || colors.info;
        return (
          <div
            key={t.id}
            style={{
              padding: '10px 16px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 12,
              minWidth: 280, maxWidth: 480,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="关闭通知"
              style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}