interface MessageBubbleProps {
  content: string;
  isMine: boolean;
  timestamp?: string;
  read?: boolean;
}

export function MessageBubble({ content, isMine, timestamp, read }: MessageBubbleProps) {
  return (
    <div className={`cp-bubble ${isMine ? 'mine' : 'theirs'}`}>
      <div className="cp-bubble-content">{content}</div>
      {timestamp && (
        <div className="cp-bubble-meta">
          {new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          {isMine && read != null && (read ? ' · 已读' : ' · 未读')}
        </div>
      )}
    </div>
  );
}