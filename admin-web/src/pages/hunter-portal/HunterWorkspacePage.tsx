import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';

/**
 * Hunter Workspace dashboard — Phase 3a / Task 12 will fill in the real
 * dashboard (kanban summary, task list, recent candidates, placement stats).
 *
 * For now this is a minimal stub so the post-login redirect
 * (`/hunter/workspace`) actually has a destination in Task 11. Auth is
 * enforced at the route level by `RequireHunterAuth`.
 */
export function HunterWorkspacePage() {
  return (
    <div className="hp-page">
      <HunterSidebar />
      <HunterMobileLayout title="工作台">
        <h1>Hunter Workspace</h1>
        <p>Dashboard goes here in Task 12.</p>
      </HunterMobileLayout>
    </div>
  );
}
