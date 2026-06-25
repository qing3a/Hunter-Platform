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
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export default function ConfirmModal({
  open, title, message,
  confirmText = '确认', cancelText = '取消',
  variant = 'primary',
  error = null,
  onConfirm, onClose,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const displayError = error ?? localError;

  const handleConfirm = async () => {
    setLoading(true);
    setLocalError(null);
    try {
      await onConfirm();
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