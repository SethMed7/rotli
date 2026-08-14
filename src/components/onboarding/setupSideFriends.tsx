import { Character } from "../character";

/** Quiet, shared edge companions for the complete first-run journey. */
export function SetupSideFriends() {
  return (
    <div className="setup-side-friends" aria-hidden="true">
      <span className="setup-side-friend setup-side-friend--left setup-side-friend--upper setup-side-friend--beat-1">
        <Character name="notes" size={94} />
      </span>
      <span className="setup-side-friend setup-side-friend--right setup-side-friend--middle setup-side-friend--beat-2">
        <Character name="searching" size={88} />
      </span>
      <span className="setup-side-friend setup-side-friend--left setup-side-friend--lower setup-side-friend--beat-3">
        <Character name="rest" size={90} />
      </span>
      <span className="setup-side-friend setup-side-friend--right setup-side-friend--upper setup-side-friend--beat-4">
        <Character name="waving" size={92} />
      </span>
    </div>
  );
}
