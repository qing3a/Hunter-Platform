// ============================================================================
// PublishStatus (S2 / Task 5 — PM UI Visual Fidelity)
// ============================================================================
//
// Per-row ERP publish chip for the positions table. Renders one of four
// statuses (`unpublished` / `publishing` / `published` / `failed`) with the
// appropriate label, optional metadata (timestamp / failure reason), and a
// publish / republish button when the status warrants user action.
//
// For v1 there is no real ERP backend — every row is hardcoded to
// `unpublished` by the parent PositionTable. When the publish endpoint
// ships in a later task, this component is ready to receive real state.

type Status = 'unpublished' | 'publishing' | 'published' | 'failed';

interface Props {
  status: Status;
  publishedAt?: number;
  failureReason?: string;
  onPublish: () => void;
  onRepublish: () => void;
}

const COPY: Record<Status, string> = {
  unpublished: '未发布',
  publishing: '发布中…',
  published: '已发布',
  failed: '发布失败',
};

export function PublishStatus({ status, publishedAt, failureReason, onPublish, onRepublish }: Props) {
  const isPublished = status === 'published';
  return (
    <div className={`pm-publish pm-publish--${status}`} data-testid={`pm-publish-chip-${status}`}>
      <span className="pm-publish-label">{COPY[status]}</span>
      {isPublished && publishedAt && (
        <span className="pm-publish-time">{new Date(publishedAt).toLocaleDateString('zh-CN')}</span>
      )}
      {status === 'failed' && failureReason && (
        <span className="pm-publish-reason">{failureReason}</span>
      )}
      {(status === 'unpublished' || status === 'failed') && (
        <button
          className="pm-btn-secondary pm-publish-btn"
          onClick={status === 'failed' ? onRepublish : onPublish}
        >
          {status === 'unpublished' ? '📤 发布' : '🔄 重发'}
        </button>
      )}
    </div>
  );
}