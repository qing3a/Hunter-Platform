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
import AdminCandidateDetailPage from './pages/CandidateDetailPage';
import RecommendationDetailPage from './pages/RecommendationDetailPage';
import WebhookDeadLetterPage from './pages/WebhookDeadLetterPage';
import PlacementsPage from './pages/PlacementsPage';
import SettingsPage from './pages/SettingsPage';
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from '@hunter-platform/shared-web/lib';
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
// Tasks 12-16 add the kanban / candidates / tasks / settings pages).
import { HunterLoginPage } from './pages/hunter-portal/HunterLoginPage';
import { HunterWorkspacePage } from './pages/hunter-portal/HunterWorkspacePage';
import { PickupQueuePage } from './pages/hunter-portal/PickupQueuePage';
import { CandidateListPage } from './pages/hunter-portal/CandidateListPage';
import { KanbanPage } from './pages/hunter-portal/KanbanPage';
import { CandidateDetailPage as HunterCandidateDetailPage } from './pages/hunter-portal/CandidateDetailPage';
import { ComparisonPage } from './pages/hunter-portal/ComparisonPage';
import { TasksPage } from './pages/hunter-portal/TasksPage';
import { HunterSettingsPage } from './pages/hunter-portal/HunterSettingsPage';
import { RequireHunterAuth } from './components/hunter-portal/RequireHunterAuth';

// PM Workbench pages (Task 17 wires the full route tree behind RequirePMAuth;
// Tasks 3-16 created the individual page modules).
import { PMLoginPage } from './pages/pm-portal/PMLoginPage';
import { ProjectsLibraryPage } from './pages/pm-portal/ProjectsLibraryPage';
import { ProjectDetailPage } from './pages/pm-portal/ProjectDetailPage';
import { PlanComparisonPage } from './pages/pm-portal/PlanComparisonPage';
import { PipelineSandboxPage } from './pages/pm-portal/PipelineSandboxPage';
import { CandidateMatchesPage } from './pages/pm-portal/CandidateMatchesPage';
import { CandidateLibraryPage } from './pages/pm-portal/CandidateLibraryPage';
import { CandidateDetailPage as PMCandidateDetailPage } from './pages/pm-portal/CandidateDetailPage';
import { GlobalSnapshotPage } from './pages/pm-portal/GlobalSnapshotPage';
import { PMSettingsPage } from './pages/pm-portal/PMSettingsPage';
import { RequirePMAuth } from './components/pm-portal/RequirePMAuth';
import { PMMobileLayout } from './components/pm-portal/PMMobileLayout';

// Employer Panel pages (Phase 3c — Task 4 ships Login + Dashboard;
// Task 5 adds Jobs; Tasks 6-9 will add Candidates / Placements /
// PendingClaims / Settings under the same RequireEmployerAuth layout).
import { EmployerLoginPage } from './pages/employer-portal/EmployerLoginPage';
import { EmployerDashboardPage } from './pages/employer-portal/EmployerDashboardPage';
import { JobsManagementPage } from './pages/employer-portal/JobsManagementPage';
import { BrowseTalentPage } from './pages/employer-portal/BrowseTalentPage';
import { PlacementsPage as EmployerPlacementsPage } from './pages/employer-portal/PlacementsPage';
import { PendingClaimsPage } from './pages/employer-portal/PendingClaimsPage';
import { SettingsPage as EmployerSettingsPage } from './pages/employer-portal/SettingsPage';
import { RequireEmployerAuth } from './components/employer-portal/RequireEmployerAuth';
import { EmployerMobileLayout } from './components/employer-portal/EmployerMobileLayout';

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
      <Route path="candidates/:id" element={<PrivateRoute><AdminCandidateDetailPage /></PrivateRoute>} />
      <Route path="candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
      <Route path="jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
      <Route path="jobs/:id" element={<PrivateRoute><JobDetailPage /></PrivateRoute>} />
      <Route path="jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
      <Route path="recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
      <Route path="recommendations/:id" element={<PrivateRoute><RecommendationDetailPage /></PrivateRoute>} />
      <Route path="recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
      <Route path="webhooks/dead-letter" element={<PrivateRoute><WebhookDeadLetterPage /></PrivateRoute>} />
      <Route path="settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
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

        {/* Candidate Portal — auth via RequireAuth (OTP session) */}
        <Route path="/candidate/login" element={<CandidateLoginPage />} />
        <Route path="/candidate" element={<Navigate to="/candidate/home" replace />} />
        <Route path="/candidate/" element={<Navigate to="/candidate/home" replace />} />
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
        <Route path="/hunter/" element={<Navigate to="/hunter/workspace" replace />} />
        <Route path="/hunter/workspace" element={<RequireHunterAuth><HunterWorkspacePage /></RequireHunterAuth>} />
        <Route path="/hunter/pickup" element={<RequireHunterAuth><PickupQueuePage /></RequireHunterAuth>} />
        <Route path="/hunter/candidates" element={<RequireHunterAuth><CandidateListPage /></RequireHunterAuth>} />
        <Route path="/hunter/candidates/:id" element={<RequireHunterAuth><HunterCandidateDetailPage /></RequireHunterAuth>} />
        <Route path="/hunter/kanban" element={<RequireHunterAuth><KanbanPage /></RequireHunterAuth>} />
        <Route path="/hunter/compare" element={<RequireHunterAuth><ComparisonPage /></RequireHunterAuth>} />
        <Route path="/hunter/tasks" element={<RequireHunterAuth><TasksPage /></RequireHunterAuth>} />
        <Route path="/hunter/settings" element={<RequireHunterAuth><HunterSettingsPage /></RequireHunterAuth>} />
        <Route path="/hunter/*" element={<Navigate to="/hunter/workspace" replace />} />

        {/* PM Workbench — Task 17 wires the full /admin/pm/* tree behind
            RequirePMAuth. The login page stays public; everything else is
            nested under a layout-route that renders `<PMMobileLayout />`
            (topbar + sidebar on desktop / tab bar on mobile + <Outlet />).
            Unknown /admin/pm/* paths bounce to /admin/pm/projects. */}
        <Route path="/admin/pm/login" element={<PMLoginPage />} />
        <Route path="/admin/pm" element={<Navigate to="/admin/pm/snapshot" replace />} />
        <Route path="/admin/pm/" element={<Navigate to="/admin/pm/snapshot" replace />} />
        <Route
          element={
            <RequirePMAuth>
              <PMMobileLayout />
            </RequirePMAuth>
          }
        >
          <Route path="/admin/pm/snapshot" element={<GlobalSnapshotPage />} />
          <Route path="/admin/pm/projects" element={<ProjectsLibraryPage />} />
          <Route path="/admin/pm/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/admin/pm/projects/:id/compare" element={<PlanComparisonPage />} />
          <Route
            path="/admin/pm/projects/:id/positions/:positionId/sandbox"
            element={<PipelineSandboxPage />}
          />
          <Route
            path="/admin/pm/projects/:id/positions/:positionId/matches"
            element={<CandidateMatchesPage />}
          />
          <Route path="/admin/pm/library" element={<CandidateLibraryPage />} />
          <Route path="/admin/pm/candidates/:userId" element={<PMCandidateDetailPage />} />
          <Route path="/admin/pm/settings" element={<PMSettingsPage />} />
          <Route path="/admin/pm/*" element={<Navigate to="/admin/pm/projects" replace />} />
        </Route>

        {/* Employer Panel — Task 4 ships Login + Dashboard. Tasks 5-9 will
            add /jobs /candidates /placements /pending-claims /settings under
            the same RequireEmployerAuth layout. Unknown /admin/employer/*
            paths bounce to /admin/employer/dashboard. The login page stays
            public; everything else is nested under a layout-route that
            renders `<EmployerMobileLayout />` (topbar + sidebar on desktop
            / tab bar on mobile + <Outlet />). */}
        <Route path="/admin/employer/login" element={<EmployerLoginPage />} />
        <Route path="/admin/employer" element={<Navigate to="/admin/employer/dashboard" replace />} />
        <Route path="/admin/employer/" element={<Navigate to="/admin/employer/dashboard" replace />} />
        <Route
          element={
            <RequireEmployerAuth>
              <EmployerMobileLayout />
            </RequireEmployerAuth>
          }
        >
          <Route path="/admin/employer/dashboard" element={<EmployerDashboardPage />} />
          <Route path="/admin/employer/jobs" element={<JobsManagementPage />} />
          <Route path="/admin/employer/candidates" element={<BrowseTalentPage />} />
          <Route path="/admin/employer/placements" element={<EmployerPlacementsPage />} />
          <Route path="/admin/employer/pending-claims" element={<PendingClaimsPage />} />
          <Route path="/admin/employer/settings" element={<EmployerSettingsPage />} />
          <Route path="/admin/employer/*" element={<Navigate to="/admin/employer/dashboard" replace />} />
        </Route>

        {/* Default: root and any unknown path → admin */}
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Toast />
    </ToastProvider>
  );
}
