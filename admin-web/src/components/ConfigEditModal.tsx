import { useState, useEffect } from 'react';
import Modal from './Modal';
import type { ConfigEntry } from '../api/config';

type ConfigEditModalProps = {
  open: boolean;
  entry: ConfigEntry | null;  // null = 新建
  onClose: () => void;
  onSave: (key: string, value: unknown, reason: string) => Promise<void>;
};

export default function ConfigEditModal({ open, entry, onClose, onSave }: ConfigEditModalProps) {
  const [key, setKey] = useState('');
  const [valueText, setValueText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(entry?.key ?? '');
      setValueText(entry ? JSON.stringify(entry.value, null, 2) : '{}');
      setReason('');
      setError(null);
    }
  }, [open, entry]);

  const handleSave = async () => {
    if (!key) { setError('Key 不能为空'); return; }
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) {
      setError('Key 格式：lowercase.dotted.path（如 platform.fee.pct）'); return;
    }
    if (reason.trim().length < 3) { setError('原因至少 3 字符'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(valueText); } catch (e: any) {
      setError('Value 不是合法 JSON：' + e.message); return;
    }
    setLoading(true);
    try {
      await onSave(key, parsed, reason.trim());
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title={entry ? '编辑 Config' : '新建 Config Key'} onClose={onClose} footer={
      <>
        <button onClick={onClose} disabled={loading} className="btn">取消</button>
        <button onClick={handleSave} disabled={loading} className="btn btn-primary" data-testid="config-save">保存</button>
      </>
    }>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Key *</label>
        <input
          type="text"
          value={key}
          onChange={e => setKey(e.target.value)}
          disabled={!!entry}
          placeholder="lowercase.dotted.path"
          data-testid="config-key"
          style={{ width: '100%', height: 32, padding: '0 8px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Value (JSON) *</label>
        <textarea
          value={valueText}
          onChange={e => setValueText(e.target.value)}
          rows={8}
          data-testid="config-value"
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>原因 *</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          placeholder="至少 3 字符（写入 audit log）"
          data-testid="config-reason"
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>
      {error && <div style={{ color: '#a8071a', marginTop: 8 }} data-testid="config-modal-error">{error}</div>}
    </Modal>
  );
}
