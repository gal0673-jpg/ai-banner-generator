import { getInputProps } from "remotion";
import { Design1Composition } from "./Composition1.jsx";
import { Design2Composition } from "./Composition2.jsx";

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

function isImmersiveLayout(src) {
  const layout = src.video_layout ?? src.videoLayout;
  if (layout === "immersive") return true;
  if (layout === "split") return false;
  const t = src.designTemplate ?? src.design_type ?? src.designType;
  if (t === 2 || t === "2") return true;
  return false;
}

/**
 * Single registered Remotion composition: switches layout by video_layout / designTemplate.
 */
export function UnifiedBannerComposition(props) {
  const merged = pickMergedProps(props);
  const immersive = isImmersiveLayout(merged);
  const {
    designTemplate: _dt,
    design_type: _ds,
    designType: _d3,
    video_layout: _vl,
    videoLayout: _vL,
    ...rest
  } = merged;

  return immersive ? (
    <Design2Composition {...rest} />
  ) : (
    <Design1Composition {...rest} />
  );
}
