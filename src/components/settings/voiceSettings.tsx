// Settings → AI Models → Voice. Read-aloud is a development-build capability
// (feature policy `voice`); stable builds name it as coming soon with the
// controls shown inert, and never load a voice model.
import { COMING_SOON_CAPTION } from "../../lib/featurePolicy";
import { VOICES } from "../../voice/speech";
import { Seg } from "./seg";

const READ_ALOUD_OPTIONS: [string, string][] = [
  ["off", "Off"],
  ["on", "Read replies aloud"],
];

export function VoiceSettings({
  available,
  readAloud,
  voice,
  onReadAloud,
  onVoice,
}: {
  available: boolean;
  readAloud: boolean;
  voice: string;
  onReadAloud: (on: boolean) => void;
  onVoice: (id: string) => void;
}) {
  if (!available)
    return (
      <section className="aisection">
        <h4 className="set-subhead">Voice</h4>
        <p className="setnote">Read replies aloud with a speaker button on each answer.</p>
        <p className="set-soon">{COMING_SOON_CAPTION}</p>
        <Seg value="off" options={READ_ALOUD_OPTIONS} onPick={() => {}} disabled />
      </section>
    );
  return (
    <section className="aisection">
      <h4 className="set-subhead">Voice</h4>
      <p className="setnote">
        Read replies aloud with a speaker button on each answer. The voice runs on this Mac and is prepared
        the first time you use it — nothing is downloaded until then, and nothing is sent anywhere.
      </p>
      <Seg
        value={readAloud ? "on" : "off"}
        options={READ_ALOUD_OPTIONS}
        onPick={(v) => onReadAloud(v === "on")}
      />
      {readAloud && (
        <>
          <p className="setnote">Voice:</p>
          <Seg
            value={voice}
            options={VOICES.map((v) => [v.id, v.label] as [string, string])}
            onPick={onVoice}
          />
        </>
      )}
    </section>
  );
}
