// ============================================================================
// PMViewBanner (S5 / Task 10)
// ============================================================================
//
// Top-of-page reminder that the PM is viewing a candidate from the
// employer (PM) perspective: the page shows the anonymised surface
// only, and any contact details (phone / email / etc.) require
// unlocking. Lives at the top of the S5 candidate detail page so the
// "PM 视角" framing is visible before the PM starts scanning the
// profile / radar / match table.

export function PMViewBanner() {
  return (
    <div className="pm-view-banner" role="note" data-testid="pm-view-banner">
      <strong>PM 视角</strong> — 雇主方查看者只看到脱敏画像,联系方式需解锁
    </div>
  );
}
