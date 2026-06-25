import { useState } from 'react';
import Modal from './Modal';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  error?: string | null;
  requireReason?: boolean;
  reasonMinLength?: number;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => Promise<void>;
  onClose: () => void;
};

export default function ConfirmModal({
  open, title, message,
  confirmText = '确认', cancelText = '取消',
  variant = 'primary',
  error = null,
  requireReason = false,
  reasonMinLength = 3,
  reasonPlaceholder = '请输入原因（至少 3 字符）',
  onConfirm, onClose,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const displayError = error ?? localError;

  const handleConfirm = async () => {
    if (requireReason && reason.trim().length < reasonMinLength) {
      setLocalError(`原因至少 ${reasonMinLength} 字符`);
      return;
    }
    setLoading(true);
    setLocalError(null);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setReason('');
      onClose();
    } catch (e: any) {
      setLocalError(e?.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={loading} className="btn">{cancelText}</button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            data-testid="confirm-modal-confirm"
            className={variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
      {requireReason && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>原因 *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={2}
            data-testid="confirm-modal-reason"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>
      )}
      {displayError && (
        <div
          data-testid="confirm-modal-error"
          style={{ marginTop: 12, padding: 8, background: '#fff1f0', border: '1px solid #ff4d4f', borderRadius: 4, color: '#a8071a' }}
        >
          {displayError}
        </div>
      )}
    </Modal>
  );
}
