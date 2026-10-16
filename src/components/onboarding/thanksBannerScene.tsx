// The thank-you banner as a full scene (the owner, 2026-10-15: "the quokka in
// an illustrated scene filling the banner, not a quokka in a circle"). It is
// the person's theme's own scenery — the Settings page's sky and horizon
// (settingsBackdropArt.tsx), so nothing new is drawn — with setup's plain
// quokka standing on the ground and the thank-you in the calm sky on the
// left. Like every scene, painted only by `.sc-*` token classes, so it reads
// in every theme family, light and dark.

import { bannerText } from "../../lib/thanksBanner";
import { useUiStore } from "../../state/ui";
import { Character } from "../character";
import { SETTINGS_BACKDROPS } from "../settings/settingsBackdropArt";
import { HORIZON_FRAME } from "../settings/settingsBanner";

export function ThanksBannerScene() {
  const family = useUiStore((s) => s.themeFamily);
  const userName = useUiStore((s) => s.userName);
  const scenery = SETTINGS_BACKDROPS[family] ?? SETTINGS_BACKDROPS.warm;
  const text = bannerText(userName);
  return (
    <figure className="thanks-banner" data-scenery={family}>
      <svg className="thanks-banner-sky" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
        <circle className="sc-sun" cx="236" cy="62" r="26" />
        {scenery.sky}
      </svg>
      <svg className="thanks-banner-horizon" {...HORIZON_FRAME} aria-hidden="true" focusable="false">
        {scenery.horizon}
      </svg>
      {/* setup's quokka stays plain: dressing it is a Settings choice */}
      <Character name="celebrating" size={220} className="thanks-banner-quokka" accessorized={false} />
      <figcaption className="thanks-banner-words">
        <span className="thanks-banner-headline">{text.headline}</span>
        <span className="thanks-banner-subline">{text.subline}</span>
        <span className="thanks-banner-site">rotli.co</span>
      </figcaption>
    </figure>
  );
}
