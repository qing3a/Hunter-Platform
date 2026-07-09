interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="cp-empty-state">
      <div className="cp-empty-icon">{icon}</div>
      <div className="cp-empty-title">{title}</div>
      {description && <div className="cp-empty-desc">{description}</div>}
      {action && (
        <button className="cp-empty-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}