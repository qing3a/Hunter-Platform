// app-web — PM + HR + candidate unified SPA
//
// Phase 4.5 delivers the skeleton + restored portal code (pages/, components/, lib/).
// Phase 5 will rewrite this file to add the role switcher and gate UI by activeRole
// (per ow-recruit's `window.OW_RELAY.activeRole` model in prototype.html line 8384-8660).
//
// For now, this placeholder just renders a div so the SPA mounts and the Playwright
// regression test can verify the bundle.
export default function App() {
  return <div>app-web skeleton — Phase 5 adds role switcher + session token auth</div>;
}
