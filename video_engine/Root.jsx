import { Composition, registerRoot } from "remotion";
import { BannerComposition, defaultBannerProps } from "./Composition.jsx";

export const RemotionRoot = () => (
  <>
    <Composition
      id="Banner"
      component={BannerComposition}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={defaultBannerProps}
    />
  </>
);

registerRoot(RemotionRoot);
