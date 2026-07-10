interface Props {
  suggestion: string;
  onApply: () => void;
  onDismiss: () => void;
}

export function AISuggestionBanner({ suggestion, onApply, onDismiss }: Props) {
  return (
    <div className="pm-ai-suggestion" data-testid="pm-ai-suggestion" role="note">
      <div className="pm-ai-suggestion-body">
        💡 <strong>AI 建议</strong>：{suggestion}
      </div>
      <div className="pm-ai-suggestion-actions">
        <button className="pm-btn-primary" onClick={onApply} data-testid="pm-ai-suggestion-apply">采纳</button>
        <button className="pm-btn-secondary" onClick={onDismiss} data-testid="pm-ai-suggestion-dismiss">忽略</button>
      </div>
    </div>
  );
}
