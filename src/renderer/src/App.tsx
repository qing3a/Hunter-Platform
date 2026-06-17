import { useState } from 'react';
import Sidebar, { type PageName } from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import CandidateAudit from './pages/CandidateAudit';
import AuditLog from './pages/AuditLog';
import WebhookManagement from './pages/WebhookManagement';
import RateLimitManagement from './pages/RateLimitManagement';
import ConfigCenter from './pages/ConfigCenter';
import './styles/admin.css';

const PAGES: Record<PageName, () => JSX.Element> = {
  dashboard: Dashboard,
  users: UserManagement,
  candidates: CandidateAudit,
  audit: AuditLog,
  webhooks: WebhookManagement,
  rateLimit: RateLimitManagement,
  config: ConfigCenter,
};

export default function App(): JSX.Element {
  const [page, setPage] = useState<PageName>('dashboard');
  const PageComponent = PAGES[page];
  return (
    <div className="admin-layout">
      <Sidebar current={page} onChange={setPage} />
      <main className="main">
        <PageComponent />
      </main>
    </div>
  );
}