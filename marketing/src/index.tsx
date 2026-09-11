import { registerRoot, Composition } from 'remotion';
import { LaunchFilm } from './launchFilm';

const Root = () => <>
  <Composition id="LaunchLandscape" component={LaunchFilm} durationInFrames={540} fps={30} width={1920} height={1080} />
  <Composition id="LaunchPortrait" component={LaunchFilm} durationInFrames={540} fps={30} width={1080} height={1920} />
</>;
registerRoot(Root);
