import { useState, useEffect } from 'react';
import Modal from './Modal';

type QuotaModalProps = {
  open: boolean;
  user: { id: string; name: string; current_quota: number } | null;
  onClose: () => void;
  onSubmit: (params: { new_quota: number; reason: string }) => Promise<void>;
};

export default function QuotaModal({ open, user, onClose, onSubmit }: QuotaModalProps) {
  const [newQuota, setNewQuota] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open && user) {
      setNewQuota(String(user.current_quota));
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [open, user]);

  if (!user) return null;

  const handleSubmit = async () => {
    setError(null);
    const n = Number(newQuota);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      setError('配额必须是 0-100000 的数字');
      return;
    }
    if (reason.trim().length < 3) {
      setError('原因至少 3 个字符');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ new_quota: n, reason: reason.trim() });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`调配额 — ${user.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button onClick={onClose} disabled={submitting} className="btn">取消</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn btn-primary">
            {submitting ? '调整中...' : '确认调整'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 16, color: '#666' }}>
        当前配额：<strong>{user.current_quota}</strong> / 每天
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>
          新配额 <span style={{ color: 'red' }}>*</span>
        </label>
        <input
          type="number"
          min={0}
          max={100000}
          value={newQuota}
          onChange={e => setNewQuota(e.target.value)}
          disabled={submitting}
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
        />
        <small style={{ color: '#888' }}>范围 0-100000</small>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>
          原因 <span style={{ color: 'red' }}>*</span>
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          minLength={3}
          maxLength={500}
          disabled={submitting}
          rows={3}
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
        <small style={{ color: '#888' }}>至少 3 个字符，最多 500</small>
      </div>
      {error && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff1f0', border: '1px solid #ff4d4f', borderRadius: 4, color: '#a8071a' }}>
          {error}
        </div>
      )}
    </Modal>
  );
}