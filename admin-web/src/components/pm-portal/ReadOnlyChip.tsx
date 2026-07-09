// ============================================================================
// ReadOnlyChip (Task 14 / S9)
// ============================================================================
//
// A tiny pill rendered next to the page title that tells the PM the
// Candidate Library is read-only — the authoritative candidate record
// lives in the ERP system, the PM Workbench only consumes it.
//
// Why explicit chip (vs. just hiding the action)?
// ------------------------------------------------
// The page already hides destructive / write actions (no edit button
// on the row, no create-position flow). But "hidden" is silent — a
// PM who never tries to edit might never realise why. The chip makes
// the constraint *visible* so a heads-down PM doesn't waste time
// hunting for an entry point that intentionally doesn't exist.
//
// Visual contract
// ---------------
// A small amber pill: 🔒 只读. Wrapped in a <span> so it can live
// inline next to an <h1> without breaking block flow. The
// `title="候选人权威在 ERP"` tooltip on hover restates the
// constraint in plain Chinese.
//
// testid
// ------
// `pm-readonly-chip` is the contract with the CandidateLibraryPage
// test — the page-level test asserts the chip is rendered inside the
// header without needing to query by class or text.

export function ReadOnlyChip() {
  return (
    <span
      className="pm-readonly-chip"
      data-testid="pm-readonly-chip"
      title="候选人权威在 ERP"
    >
      🔒 只读
    </span>
  );
}