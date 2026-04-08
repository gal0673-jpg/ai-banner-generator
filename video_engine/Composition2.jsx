import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const heebo = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

/** Content column width in BannerCanvas2 — scales type to match DF2_SQUARE / DF2_VERTICAL */
const D2_CONTENT_W_REF = 952;

const SNAP_FRAMES = 30;
const BASE_BULLET_START_FRAMES = [20, 30, 40];
const BASE_CTA_START_FRAME = 60;
const HOOK_FRAMES = 60;

function normalizeBrandHex(input) {
  if (!input || typeof input !== "string") return "#4F46E5";
  let s = input.trim();
  if (!s.startsWith("#")) s = `#${s}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  return "#4F46E5";
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function RtlText({ as: Tag = "div", style, children, className, ...rest }) {
  return (
    <Tag
      dir="rtl"
      className={className}
      style={{
        direction: "rtl",
        textAlign: "right",
        unicodeBidi: "isolate",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export const defaultBannerProps = {
  headline: "כותרת לדוגמה",
  background_url: "",
  subhead: "",
  cta: "",
  logo_url: "",
  brand_color: "#2563eb",
  bullet_points: [],
  isVertical: false,
  video_hook: "",
};

/** Immersive full-bleed design (Design 2) — dynamic focus-pull background + glass cards */
export const Design2Composition = ({
  headline = defaultBannerProps.headline,
  background_url = defaultBannerProps.background_url,
  subhead = defaultBannerProps.subhead,
  cta = defaultBannerProps.cta,
  logo_url = defaultBannerProps.logo_url,
  brand_color = defaultBannerProps.brand_color,
  bullet_points = defaultBannerProps.bullet_points,
  isVertical = false,
  video_hook = "",
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const brandHex = normalizeBrandHex(brand_color);
  const { r: br, g: bg, b: bb } = hexToRgb(brandHex);
  const lastF = Math.max(SNAP_FRAMES, durationInFrames - 1);

  const hasHook = Boolean(video_hook?.trim());
  const hookOffset = hasHook ? HOOK_FRAMES : 0;

  const bullets = Array.isArray(bullet_points)
    ? bullet_points.slice(0, 3).filter((x) => typeof x === "string" && x.trim())
    : [];

  // Background focus-pull animation runs from frame 0 regardless of hook
  // (hook overlay covers it during the intro phase)
  const bgScale =
    frame <= SNAP_FRAMES
      ? interpolate(frame, [0, SNAP_FRAMES], [1.3, 1.05], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(frame, [SNAP_FRAMES, lastF], [1.05, 1.1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const bgBlur =
    frame <= SNAP_FRAMES
      ? interpolate(frame, [0, SNAP_FRAMES], [20, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  // All text-content timings shifted by hookOffset
  const heroOpacity = interpolate(frame, [hookOffset, hookOffset + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const heroTranslateY = interpolate(frame, [hookOffset, hookOffset + 22], [44, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [10 + hookOffset, 30 + hookOffset], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subTranslateY = interpolate(frame, [10 + hookOffset, 30 + hookOffset], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const CTA_START_FRAME = BASE_CTA_START_FRAME + hookOffset;
  const ctaLocal = Math.max(0, frame - CTA_START_FRAME);
  const ctaScale = spring({
    frame: ctaLocal,
    fps,
    from: 0.62,
    to: 1,
    config: { damping: 12, stiffness: 210 },
  });
  const ctaOpacity = interpolate(frame, [CTA_START_FRAME, CTA_START_FRAME + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const BULLET_START_FRAMES = BASE_BULLET_START_FRAMES.map((f) => f + hookOffset);

  // Hook intro animations
  const hookTextScale = hasHook
    ? spring({
        frame: Math.min(frame, HOOK_FRAMES - 1),
        fps,
        from: 0.5,
        to: 1,
        config: { damping: 12, stiffness: 200 },
      })
    : 1;

  const introSlideY = hasHook
    ? interpolate(frame, [HOOK_FRAMES - 5, HOOK_FRAMES + 5], [0, -height], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : -height;

  const pad = Math.round(width * 0.06);
  const contentMaxW = width - pad * 2;

  const headlineFs = Math.min(
    280,
    (contentMaxW * (isVertical ? 118 : 92)) / D2_CONTENT_W_REF,
  );
  const subheadFs = Math.min(
    220,
    (contentMaxW * (isVertical ? 48 : 36)) / D2_CONTENT_W_REF,
  );
  const bulletFs = Math.min(
    180,
    (contentMaxW * (isVertical ? 34 : 28)) / D2_CONTENT_W_REF,
  );
  const ctaFs = Math.min(
    220,
    (contentMaxW * (isVertical ? 52 : 44)) / D2_CONTENT_W_REF,
  );

  // For vertical: push content into the bottom 60% of the frame
  const verticalTopPad = isVertical ? Math.round(height * 0.4) : 0;

  return (
    <AbsoluteFill
      dir="rtl"
      lang="he"
      style={{
        backgroundColor: "#0a0f1a",
        color: "#f8fafc",
        fontFamily: `${heebo.fontFamily}, "Segoe UI", sans-serif`,
        textAlign: "right",
        direction: "rtl",
        overflow: "hidden",
      }}
    >
      {/* Full-bleed background with focus-pull zoom */}
      {background_url ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "100%",
              height: "100%",
              transform: `translate(-50%, -50%) scale(${bgScale})`,
              filter: `blur(${bgBlur}px)`,
            }}
          >
            <Img
              src={background_url}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* Dark gradient overlay */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `
            radial-gradient(ellipse 120% 80% at 85% 12%, rgba(${br},${bg},${bb},0.22) 0%, transparent 52%),
            linear-gradient(180deg, rgba(6, 10, 20, 0.45) 0%, rgba(6, 10, 20, 0.72) 45%, rgba(4, 8, 18, 0.92) 100%),
            radial-gradient(ellipse 140% 100% at 50% 50%, transparent 0%, rgba(0, 0, 0, 0.55) 100%)
          `,
        }}
      />

      {/* Brand accent bar — horizontal bottom edge for vertical, vertical left edge for horizontal */}
      {isVertical ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 6,
            background: brandHex,
            boxShadow: `0 0 24px rgba(${br},${bg},${bb},0.5)`,
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            background: brandHex,
            boxShadow: `0 0 24px rgba(${br},${bg},${bb},0.5)`,
          }}
        />
      )}

      {/* Main content — shifted to bottom 60% for vertical */}
      <AbsoluteFill
        style={{
          paddingTop: verticalTopPad + pad,
          paddingBottom: pad,
          paddingLeft: pad,
          paddingRight: pad,
          display: "flex",
          flexDirection: "column",
          justifyContent: isVertical ? "flex-start" : "center",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: contentMaxW,
            marginInlineStart: "auto",
            marginInlineEnd: 0,
            display: "flex",
            flexDirection: "column",
            gap: height * 0.022,
          }}
        >
          <div
            style={{
              opacity: heroOpacity,
              transform: `translateY(${heroTranslateY}px)`,
            }}
          >
            {logo_url ? (
              <div style={{ marginBottom: height * 0.02 }}>
                <Img
                  src={logo_url}
                  style={{
                    maxWidth: Math.min(220, width * 0.22),
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 4px 20px rgba(0,0,0,0.45))",
                  }}
                />
              </div>
            ) : null}

            <RtlText
              as="h1"
              style={{
                margin: 0,
                fontSize: headlineFs,
                fontWeight: 800,
                lineHeight: 1.12,
                letterSpacing: "-0.02em",
                color: "#ffffff",
                textShadow: "0 4px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)",
              }}
            >
              {headline}
            </RtlText>
          </div>

          {subhead ? (
            <RtlText
              as="p"
              style={{
                margin: 0,
                fontSize: subheadFs,
                fontWeight: 500,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.9)",
                opacity: subOpacity,
                transform: `translateY(${subTranslateY}px)`,
                textShadow: "0 2px 16px rgba(0,0,0,0.45)",
              }}
            >
              {subhead}
            </RtlText>
          ) : null}

          {bullets.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                marginTop: height * 0.012,
              }}
            >
              {bullets.map((text, i) => {
                const start = BULLET_START_FRAMES[i] ?? 20 + hookOffset + i * 10;
                const local = Math.max(0, frame - start);
                const pop = spring({
                  frame: local,
                  fps,
                  from: 0.5,
                  to: 1,
                  config: { damping: 14, stiffness: 260 },
                });
                const bulletOpacity = interpolate(local, [0, 8], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });

                return (
                  <div
                    key={i}
                    style={{
                      opacity: bulletOpacity,
                      transform: `scale(${pop})`,
                      transformOrigin: "center right",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        gap: 16,
                        padding: "18px 22px",
                        borderRadius: 16,
                        background:
                          "linear-gradient(135deg, rgba(15,23,42,0.88) 0%, rgba(15,23,42,0.72) 100%)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        boxShadow:
                          "0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
                      }}
                    >
                      <div
                        style={{
                          flexShrink: 0,
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          backgroundColor: brandHex,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 22,
                          fontWeight: 700,
                          boxShadow: `0 6px 18px rgba(${br},${bg},${bb},0.45)`,
                        }}
                        aria-hidden
                      >
                        ✓
                      </div>
                      <RtlText
                        style={{
                          flex: 1,
                          fontSize: bulletFs,
                          fontWeight: 500,
                          lineHeight: 1.45,
                          color: "rgba(248,250,252,0.96)",
                        }}
                      >
                        {text}
                      </RtlText>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {cta ? (
            <div
              style={{
                marginTop: height * 0.028,
                opacity: ctaOpacity,
                transform: `scale(${ctaScale})`,
                transformOrigin: "center right",
                alignSelf: "stretch",
              }}
            >
              <RtlText
                style={{
                  display: "block",
                  padding: `${height * 0.022}px ${width * 0.06}px`,
                  borderRadius: 14,
                  backgroundColor: brandHex,
                  color: "#ffffff",
                  fontWeight: 800,
                  fontSize: ctaFs,
                  textAlign: "center",
                  boxShadow: `0 16px 48px rgba(${br},${bg},${bb},0.55), 0 4px 12px rgba(0,0,0,0.35)`,
                  letterSpacing: "0.02em",
                }}
              >
                {cta}
              </RtlText>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {/* Whoosh sound fires exactly at the hook transition frame */}
      {hasHook && (
        <Sequence from={HOOK_FRAMES}>
          <Audio src={staticFile("whoosh.mp3")} />
        </Sequence>
      )}

      {/* Ding fires at the start frame of each feature bullet */}
      {bullets.map((_, i) => {
        const st = BULLET_START_FRAMES[i] ?? 20 + hookOffset + i * 10;
        return (
          <Sequence key={`ding-${i}`} from={st}>
            <Audio src={staticFile("ding.mp3")} />
          </Sequence>
        );
      })}

      {/* Hook intro overlay — spring-scales in, then slides up out of frame at HOOK_FRAMES */}
      {hasHook && (
        <AbsoluteFill
          style={{
            backgroundColor: brandHex,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `translateY(${introSlideY}px)`,
            zIndex: 10,
          }}
        >
          <div
            dir="rtl"
            style={{
              fontSize: Math.min(300, height * 0.15),
              fontWeight: 800,
              color: "#ffffff",
              textAlign: "center",
              padding: "0 60px",
              transform: `scale(${hookTextScale})`,
              lineHeight: 1.2,
              textShadow: "0 4px 32px rgba(0,0,0,0.3)",
              fontFamily: `${heebo.fontFamily}, "Segoe UI", sans-serif`,
            }}
          >
            {video_hook}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
