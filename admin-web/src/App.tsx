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
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from './lib/toast';
import Toast from './components/Toast';

// Candidate Portal pages
import { LoginPage as CandidateLoginPage } from './pages/candidate-portal/LoginPage';
import { HomePage } from './pages/candidate-portal/HomePage';
import { BrowsePage } from './pages/candidate-portal/BrowsePage';
import { JobDetailPage as CandidateJobDetailPage } from './pages/candidate-portal/JobDetailPage';
import { ApplicationsPage } from './pages/candidate-portal/ApplicationsPage';
import { ApplicationDetailPage } from './pages/candidate-portal/ApplicationDetailPage';
import { OfferPage } from './pages/candidate-portal/OfferPage';
import { MessagesPage } from './pages/candidate-portal/MessagesPage';
import { ProfilePage as CandidateProfilePage } from './pages/candidate-portal/ProfilePage';
import { RequireAuth } from './components/candidate-portal/RequireAuth';

// Hunter Portal pages (Phase 3a — Task 11 ships only Login + Workspace;
// Tasks 12-16 will add the kanban / candidates / tasks / settings pages).
import { HunterLoginPage } from './pages/hunter-portal/HunterLoginPage';
import { HunterWorkspacePage } from './pages/hunter-portal/HunterWorkspacePage';
import { PickupQueuePage } from './pages/hunter-portal/PickupQueuePage';
import { RequireHunterAuth } from './components/hunter-portal/RequireHunterAuth';

// Admin sub-app: all admin routes live under /admin/* (no nested router).
// The single outer BrowserRouter in main.tsx owns the routing context.
function AdminApp() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="/admin/users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />
      <Route path="/admin/users/:id" element={<PrivateRoute><UserDetailPage /></PrivateRoute>} />
      <Route path="/admin/users/:id/timeline" element={<PrivateRoute><UserTimelinePage /></PrivateRoute>} />
      <Route path="/admin/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
      <Route path="/admin/candidates/:id" element={<PrivateRoute><CandidateDetailPage /></PrivateRoute>} />
      <Route path="/admin/candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
      <Route path="/admin/jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
      <Route path="/admin/jobs/:id" element={<PrivateRoute><JobDetailPage /></PrivateRoute>} />
      <Route path="/admin/jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
      <Route path="/admin/recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
      <Route path="/admin/recommendations/:id" element={<PrivateRoute><RecommendationDetailPage /></PrivateRoute>} />
      <Route path="/admin/recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
      <Route path="/admin/webhooks/dead-letter" element={<PrivateRoute><WebhookDeadLetterPage /></PrivateRoute>} />
      <Route path="/admin/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
      <Route path="/admin/placements" element={<PrivateRoute><PlacementsPage /></PrivateRoute>} />
      <Route path="/admin/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
      <Route path="/admin/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
      <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* Admin Portal — guarded by PrivateRoute (see AdminApp) */}
        <Route path="/admin/*" element={<AdminApp />} />

        {/* Candidate Portal — auth via RequireAuth (OTP session) */}
        <Route path="/candidate/login" element={<CandidateLoginPage />} />
        <Route path="/candidate" element={<Navigate to="/candidate/home" replace />} />
        <Route path="/candidate/home" element={<RequireAuth><HomePage /></RequireAuth>} />
        <Route path="/candidate/browse" element={<RequireAuth><BrowsePage /></RequireAuth>} />
        <Route path="/candidate/jobs/:id" element={<RequireAuth><CandidateJobDetailPage /></RequireAuth>} />
        <Route path="/candidate/applications" element={<RequireAuth><ApplicationsPage /></RequireAuth>} />
        <Route path="/candidate/applications/:id" element={<RequireAuth><ApplicationDetailPage /></RequireAuth>} />
        <Route path="/candidate/offer" element={<RequireAuth><OfferPage /></RequireAuth>} />
        <Route path="/candidate/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
        <Route path="/candidate/profile" element={<RequireAuth><CandidateProfilePage /></RequireAuth>} />
        <Route path="/candidate/*" element={<Navigate to="/candidate/home" replace />} />

        {/* Hunter Portal — auth via RequireHunterAuth (role=headhunter) */}
        <Route path="/hunter/login" element={<HunterLoginPage />} />
        <Route path="/hunter" element={<Navigate to="/hunter/workspace" replace />} />
        <Route path="/hunter/workspace" element={<RequireHunterAuth><HunterWorkspacePage /></RequireHunterAuth>} />
        <Route path="/hunter/pickup" element={<RequireHunterAuth><PickupQueuePage /></RequireHunterAuth>} />
        {/* TODO Task 12+ — add /hunter/{candidates,kanban,tasks,settings} here
            when those pages are built. The catch-all below keeps unknown paths
            bouncing to /hunter/workspace for now. */}
        <Route path="/hunter/*" element={<Navigate to="/hunter/workspace" replace />} />

        {/* Default: root and any unknown path → admin */}
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Toast />
    </ToastProvider>
  );
}
