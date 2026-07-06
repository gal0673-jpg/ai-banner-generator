export const DESIGN_TOKENS = {
  banner: {
    sizes: {
      square_1_1: { width: 1080, height: 1080 },
      vertical_9_16: { width: 1080, height: 1920 },
    },
    safeArea: {
      vertical_9_16: {
        bottom_ratio: 0.12,
      },
    },
  },
  fonts: {
    design1: {
      square: { headline: 54, subhead: 26, bullets: 20, cta: 30 },
      vertical: { headline: 92, subhead: 42, bullets: 34, cta: 48 },
      remotion: { vertical_text_panel_h_ref: 1152 },
    },
    design2: {
      square: { headline: 92, subhead: 36, bullets: 28, cta: 44 },
      vertical: { headline: 118, subhead: 48, bullets: 34, cta: 52 },
      remotion: { content_w_ref: 952 },
    },
    design3: {
      square: { headline: 62, subhead: 24, bullets: 18, cta: 28 },
      vertical: { headline: 88, subhead: 38, bullets: 28, cta: 44 },
      remotion: { content_w_ref: 688 },
    },
  },
};

export function bannerVerticalBottomSafePx(height) {
  const ratio = Number(DESIGN_TOKENS?.banner?.safeArea?.vertical_9_16?.bottom_ratio);
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.12;
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.round(h * r);
}

export function fontSizesForDesign(designNumber, isVertical) {
  const d = Number(designNumber);
  const key = d === 2 ? "design2" : d === 3 ? "design3" : "design1";
  const side = isVertical ? "vertical" : "square";
  return DESIGN_TOKENS?.fonts?.[key]?.[side] || null;
}

