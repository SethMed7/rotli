import { Character } from "../character";

/** Quiet, shared edge companions for the complete first-run journey. */
export function SetupSideFriends() {
  return (
    <div className="setup-side-friends" aria-hidden="true">
      <span className="setup-side-friend setup-side-friend--left setup-side-friend--upper setup-side-friend--beat-1">
        <Character name="thoughtful" size={94} alwaysVisible />
      </span>
      <span className="setup-side-friend setup-side-friend--right setup-side-friend--middle setup-side-friend--beat-2">
        <Character name="walking" size={88} alwaysVisible />
      </span>
      <span className="setup-side-friend setup-side-friend--left setup-side-friend--lower setup-side-friend--beat-3">
        <Character name="listening" size={90} alwaysVisible />
      </span>
      <span className="setup-side-friend setup-side-friend--right setup-side-friend--upper setup-side-friend--beat-4">
        <Character name="attention" size={92} alwaysVisible />
      </span>
    </div>
  );
}
