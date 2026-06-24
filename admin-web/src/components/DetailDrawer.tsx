import { useEffect } from 'react';

type DetailDrawerProps = {
  open: boolean;
  title: string;
  data: unknown;
  onClose: () => void;
};

export default function DetailDrawer({ open, title, data, onClose }: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const body = data === null || data === undefined
    ? '暂无数据'
    : typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
        }}
      />
      <aside
        role="dialog"
        aria-label={title}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 480, background: 'white', padding: 24,
          boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
          zIndex: 101, overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} aria-label="关闭" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>
        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {body}
        </pre>
      </aside>
    </>
  );
}