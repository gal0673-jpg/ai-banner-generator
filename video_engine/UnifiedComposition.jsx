import { getInputProps } from "remotion";
import { Design1Composition } from "./Composition1.jsx";
import { Design2Composition } from "./Composition2.jsx";
import { Design3Composition } from "./Composition3.jsx";

/** Spread overlay onto base without letting explicit `undefined` wipe engine values (Remotion often forwards undefined props). */
function mergeDefined(base, overlay) {
  const out = { ...base };
  if (overlay && typeof overlay === "object" && !Array.isArray(overlay)) {
    for (const [k, v] of Object.entries(overlay)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

function pickMergedProps(props) {
  let fromEngine = {};
  try {
    const ip = getInputProps();
    if (ip && typeof ip === "object" && !Array.isArray(ip)) fromEngine = ip;
  } catch {
    /* Studio / environments without input props */
  }
  return mergeDefined(fromEngine, props ?? {});
}

/** Returns 1 | 2 | 3 based on any combination of layout/template hints. */
function pickDesign(src) {
  const layout = src.video_layout ?? src.videoLayout;
  if (layout === "immersive") return 2;
  if (layout === "minimal")   return 3;
  if (layout === "split")     return 1;
  const t = src.designTemplate ?? src.design_type ?? src.designType;
  if (t === 2 || t === "2") return 2;
  if (t === 3 || t === "3") return 3;
  return 1;
}

/**
 * Single registered Remotion composition: switches layout by video_layout / designTemplate.
 * Design 1 → split panel  |  Design 2 → immersive full-bleed  |  Design 3 → minimalist card
 */
export function UnifiedBannerComposition(props) {
  const merged = pickMergedProps(props);
  const design = pickDesign(merged);
  const {
    designTemplate: _dt,
    design_type:    _ds,
    designType:     _d3,
    video_layout:   _vl,
    videoLayout:    _vL,
    ...rest
  } = merged;

  if (design === 3) return <Design3Composition {...rest} />;
  if (design === 2) return <Design2Composition {...rest} />;
  return <Design1Composition {...rest} />;
}
