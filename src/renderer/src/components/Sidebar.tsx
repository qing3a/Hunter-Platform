import React from 'react';

export type PageName = 'dashboard' | 'users' | 'candidates' | 'audit' | 'webhooks' | 'rateLimit' | 'config';

export const PAGE_TITLES: Record<PageName, string> = {
  dashboard: '仪表盘',
  users: '用户管理',
  candidates: '候选人审核',
  audit: '审计日志',
  webhooks: 'Webhook 管理',
  rateLimit: '限流管理',
  config: '配置中心',
};

export const PAGE_ORDER: PageName[] = ['dashboard', 'users', 'candidates', 'audit', 'webhooks', 'rateLimit', 'config'];

interface Props {
  current: PageName;
  onChange: (page: PageName) => void;
}

export default function Sidebar({ current, onChange }: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <h1>Hunter Admin</h1>
      <nav>
        {PAGE_ORDER.map((p) => (
          <a
            key={p}
            href="#"
            className={current === p ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); onChange(p); }}
          >
            {PAGE_TITLES[p]}
          </a>
        ))}
      </nav>
    </aside>
  );
}