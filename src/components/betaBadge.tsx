import { BETA_LABEL } from "../newItems/model";

/** The one Beta mark: a calm pill beside a name, never inside another badge.
 * Surfaces that can only show text use `withBetaLabel` instead. */
export function BetaBadge({ title = "Beta: it works, and it’s still being finished" }: { title?: string }) {
  return (
    <span className="beta-badge" title={title}>
      {BETA_LABEL}
    </span>
  );
}
