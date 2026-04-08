import { Composition, registerRoot } from "remotion";
import { defaultBannerProps } from "./Composition1.jsx";
import { UnifiedBannerComposition } from "./UnifiedComposition.jsx";

const BASE_DURATION = 150;
const HOOK_FRAMES = 60;

export const RemotionRoot = () => (
  <>
    <Composition
      id="Banner"
      component={UnifiedBannerComposition}
      durationInFrames={BASE_DURATION}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{
        ...defaultBannerProps,
        designTemplate: 1,
        video_layout: "split",
        videoLayout: "split",
        isVertical: false,
        video_hook: "",
      }}
      calculateMetadata={({ props }) => {
        const isVertical = props.isVertical === true;
        const hasHook = Boolean(
          props.video_hook && typeof props.video_hook === "string" && props.video_hook.trim(),
        );
        return {
          width: 1080,
          height: isVertical ? 1920 : 1080,
          durationInFrames: BASE_DURATION + (hasHook ? HOOK_FRAMES : 0),
        };
      }}
    />
  </>
);

registerRoot(RemotionRoot);
