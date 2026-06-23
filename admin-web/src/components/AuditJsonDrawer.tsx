import AuditDiffView from './AuditDiffView';

export default function AuditJsonDrawer({
  open,
  onClose,
  title,
  json,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  json: string | null;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="drawer-backdrop"
        data-testid="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 99,
        }}
      />
      <aside
        className="drawer-panel"
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: '480px',
          background: 'white', boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
          padding: '20px', overflowY: 'auto', zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="btn">Close</button>
        </div>
        <AuditDiffView json={json} />
      </aside>
    </>
  );
}