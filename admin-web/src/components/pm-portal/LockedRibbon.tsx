interface Props {
  locked: boolean;
}

/**
 * Top-right "✓ 已锁定" badge that appears on a plan card when
 * `plan.is_selected === 1` (or any truthy coerced value).
 *
 * The ribbon uses `position: absolute` (see `.pm-locked-ribbon` in
 * pm-portal.css) so the parent card must be `position: relative`.
 * Returns `null` when not locked, so the parent renders nothing at all.
 */
export function LockedRibbon({ locked }: Props) {
  if (!locked) return null;
  return (
    <div className="pm-locked-ribbon" data-testid="pm-locked-ribbon">
      ✓ 已锁定
    </div>
  );
}
