import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messages } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { MessageBubble } from '../../components/candidate-portal/MessageBubble';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function MessagesPage() {
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox');
  const [draftTo, setDraftTo] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['messages', box],
    queryFn: () => messages.list({ box, limit: 50 }),
  });

  const sendMutation = useMutation({
    mutationFn: () => messages.send({ to_user_id: draftTo, content: draftContent }),
    onSuccess: () => {
      setDraftTo(''); setDraftContent('');
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  return (
    <MobileLayout title="消息">
      <div className="cp-msg-tabs">
        <button className={box === 'inbox' ? 'active' : ''} onClick={() => setBox('inbox')}>
          收件箱 {data?.unread_count ? `(${data.unread_count})` : ''}
        </button>
        <button className={box === 'sent' ? 'active' : ''} onClick={() => setBox('sent')}>已发送</button>
      </div>

      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.items.length === 0 && <EmptyState icon="💬" title={box === 'inbox' ? '收件箱为空' : '还没有发送过消息'} />}
      <div className="cp-msg-list">
        {(data?.items ?? []).map((m: any) => (
          <MessageBubble key={m.id} content={m.content} isMine={box === 'sent'} timestamp={m.created_at} read={!!m.read_at} />
        ))}
      </div>

      <div className="cp-msg-compose">
        <h3>发送新消息</h3>
        <input type="text" placeholder="收件人 user_id" value={draftTo} onChange={e => setDraftTo(e.target.value)} className="cp-input" />
        <textarea placeholder="消息内容..." value={draftContent} onChange={e => setDraftContent(e.target.value)} className="cp-textarea" rows={3} />
        <button className="cp-btn-primary" disabled={!draftTo || !draftContent || sendMutation.isPending} onClick={() => sendMutation.mutate()}>
          发送
        </button>
      </div>
    </MobileLayout>
  );
}
