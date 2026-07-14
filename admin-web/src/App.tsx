import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import UsersPage from './pages/UsersPage';
import CandidatesPage from './pages/CandidatesPage';
import JobsPage from './pages/JobsPage';
import RecommendationsPage from './pages/RecommendationsPage';
import AuditPage from './pages/AuditPage';
import UserTimelinePage from './pages/UserTimelinePage';
import CandidateTimelinePage from './pages/CandidateTimelinePage';
import JobTimelinePage from './pages/JobTimelinePage';
import RecommendationTimelinePage from './pages/RecommendationTimelinePage';
import UserDetailPage from './pages/UserDetailPage';
import JobDetailPage from './pages/JobDetailPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import RecommendationDetailPage from './pages/RecommendationDetailPage';
import WebhookDeadLetterPage from './pages/WebhookDeadLetterPage';
import PlacementsPage from './pages/PlacementsPage';
import SettingsPage from './pages/SettingsPage';
import RateLimitPage from './pages/RateLimitPage';
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from '@hunter-platform/shared-web/lib';
import Toast from './components/Toast';

// Admin sub-app: all admin routes live under /admin/* through the
// outer route in App. Descendant routes here must stay relative to
// that parent route so React Router can match the remaining splat.
function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route index element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />
      <Route path="users/:id" element={<PrivateRoute><UserDetailPage /></PrivateRoute>} />
      <Route path="users/:id/timeline" element={<PrivateRoute><UserTimelinePage /></PrivateRoute>} />
      <Route path="candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
      <Route path="candidates/:id" element={<PrivateRoute><CandidateDetailPage /></PrivateRoute>} />
      <Route path="candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
      <Route path="jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
      <Route path="jobs/:id" element={<PrivateRoute><JobDetailPage /></PrivateRoute>} />
      <Route path="jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
      <Route path="recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
      <Route path="recommendations/:id" element={<PrivateRoute><RecommendationDetailPage /></PrivateRoute>} />
      <Route path="recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
      <Route path="webhooks/dead-letter" element={<PrivateRoute><WebhookDeadLetterPage /></PrivateRoute>} />
      <Route path="settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
      <Route path="rate-limit" element={<PrivateRoute><RateLimitPage /></PrivateRoute>} />
      <Route path="placements" element={<PrivateRoute><PlacementsPage /></PrivateRoute>} />
      <Route path="audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
      <Route path="profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* Admin Portal — guarded by PrivateRoute (see AdminApp) */}
        <Route path="/admin/*" element={<AdminApp />} />

        {/* Default: root and any unknown path → admin */}
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Toast />
    </ToastProvider>
  );
}