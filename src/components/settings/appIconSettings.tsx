// The Dock icon is native shell integration. Web keeps the availability
// explanation instead of offering choices that cannot change an icon there.
import appIconBlack from "../../assets/appIcons/black.png";
import appIconCharcoal from "../../assets/appIcons/charcoal.png";
import appIconClay from "../../assets/appIcons/clay.png";
import appIconDefault from "../../assets/appIcons/default.png";
import appIconPaper from "../../assets/appIcons/paper.png";
import { PLATFORM, type Platform } from "../../lib/featurePolicy";
import { setAppIcon } from "../../services/appIcon";
import { type AppIcon, useUiStore } from "../../state/ui";

/** Real Dock artwork, cut from the native variant by build-app-icons.mjs. */
const APP_ICONS: { id: AppIcon; label: string; src: string }[] = [
  { id: "default", label: "Default", src: appIconDefault },
  { id: "paper", label: "Paper", src: appIconPaper },
  { id: "charcoal", label: "Charcoal", src: appIconCharcoal },
  { id: "clay", label: "Clay", src: appIconClay },
  { id: "black", label: "Black", src: appIconBlack },
];

export function AppIconSettings({ platform = PLATFORM }: { platform?: Platform }) {
  const appIcon = useUiStore((s) => s.appIcon);
  const setAppIconState = useUiStore((s) => s.setAppIcon);
  return (
    <>
      <h4 className="sethead">App icon</h4>
      {platform === "web" ? (
        <p className="setnote">In the Mac app.</p>
      ) : (
        <>
          <p className="lead">
            Pick the Dock icon — it shows when <b>Show in the Dock</b> is on.
          </p>
          <div className="appicon-row" role="radiogroup" aria-label="App icon">
            {APP_ICONS.map(({ id, label, src }) => (
              <button
                type="button"
                key={id}
                className={appIcon === id ? "appicon sel" : "appicon"}
                aria-pressed={appIcon === id}
                onClick={() => {
                  setAppIconState(id);
                  void setAppIcon(id);
                }}
              >
                <img className="appicon-tile" src={src} alt="" draggable={false} />
                <span className="appicon-label">{label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
