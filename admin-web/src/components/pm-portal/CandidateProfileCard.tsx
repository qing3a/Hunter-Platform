// ============================================================================
// CandidateProfileCard (S5 / Task 10)
// ============================================================================
//
// Left-column profile card on the S5 candidate detail page. Renders the
// anonymised surface (avatar + name + title·company + source chip +
// resume paragraph + tag list) plus a disabled "解锁联系方式" call-to-
// action. The contact-action is a deliberate placeholder: PM-side
// viewing shows a masked profile only, and unlocking the real contact
// is a paid flow handled by a later task.
//
// Data shape
// ----------
// The component is pure — the page hands it a fully-hydrated
// `CandidateProfile`. The PM-private note editor (right column) and
// the radar (also right column) are separate components with their
// own data sources; this card owns only the public/anonymised
// surface.

export interface CandidateProfile {
  displayName: string;
  title: string;
  company: string;
  source: string;
  resume: string;
  tags: string[];
  avatarUrl?: string;
}

interface Props {
  profile: CandidateProfile;
}

export function CandidateProfileCard({ profile }: Props) {
  return (
    <div className="pm-candidate-profile" data-testid="pm-candidate-profile">
      <div className="pm-candidate-avatar" aria-hidden>
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" />
        ) : (
          profile.displayName.charAt(0)
        )}
      </div>
      <h3>{profile.displayName}</h3>
      <p className="pm-candidate-title">
        {profile.title} · {profile.company}
      </p>
      <span className="pm-erp-state" data-testid="pm-candidate-source">
        {profile.source}
      </span>
      <p className="pm-candidate-resume">{profile.resume}</p>
      <ul className="pm-candidate-tags">
        {profile.tags.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <button
        className="pm-btn-primary"
        disabled
        title="联系信息需解锁"
        data-testid="pm-candidate-unlock-contact"
      >
        📞 解锁联系方式
      </button>
    </div>
  );
}
