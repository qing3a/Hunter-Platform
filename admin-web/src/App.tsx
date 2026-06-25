import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from './lib/toast';
import Toast from './components/Toast';

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter basename="/admin" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
          <Route path="/users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />
          <Route path="/users/:id/timeline" element={<PrivateRoute><UserTimelinePage /></PrivateRoute>} />
          <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
          <Route path="/candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
          <Route path="/jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
          <Route path="/jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
          <Route path="/recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
          <Route path="/recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
          <Route path="/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toast />
    </ToastProvider>
  );
}