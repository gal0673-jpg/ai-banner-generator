import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

/** Heebo with Hebrew + Latin subsets for RTL marketing copy */
const heebo = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

const BULLET_START_FRAMES = [20, 30, 40];
const CTA_START_FRAME = 60;

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

/** RTL-safe text wrapper: correct punctuation / mixed LTR runs */
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

/**
 * Default props mirror the banner JSON the FastAPI backend can send.
 */
export const defaultBannerProps = {
  headline: "כותרת לדוגמה",
  background_url: "",
  subhead: "",
  cta: "",
  logo_url: "",
  brand_color: "#2563eb",
  bullet_points: [],
};

export const BannerComposition = ({
  headline = defaultBannerProps.headline,
  background_url = defaultBannerProps.background_url,
  subhead = defaultBannerProps.subhead,
  cta = defaultBannerProps.cta,
  logo_url = defaultBannerProps.logo_url,
  brand_color = defaultBannerProps.brand_color,
  bullet_points = defaultBannerProps.bullet_points,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const brandHex = normalizeBrandHex(brand_color);
  const { r: br, g: bg, b: bb } = hexToRgb(brandHex);

  const bullets = Array.isArray(bullet_points)
    ? bullet_points.slice(0, 3).filter((x) => typeof x === "string" && x.trim())
    : [];

  const kenBurnsScale = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [1, 1.1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const heroOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const heroTranslateY = interpolate(frame, [0, 22], [44, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subTranslateY = interpolate(frame, [10, 30], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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

  const pad = Math.round(width * 0.06);
  const contentMaxW = width - pad * 2;

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
      {/* Ken Burns background */}
      {background_url ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "100%",
              height: "100%",
              transform: `translate(-50%, -50%) scale(${kenBurnsScale})`,
            }}
          >
            <Img
              src={background_url}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </div>
        </AbsoluteFill>
      ) : null}

      {/* Readability: vignette + bottom weight + brand wash */}
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

      {/* Left brand accent (Immersive-style) */}
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

      {/* Content stack */}
      <AbsoluteFill
        style={{
          padding: pad,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
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
          {/* Logo + headline — fade + slide up from below */}
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
                fontSize: Math.min(64, height * 0.072),
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

          {/* Subhead */}
          {subhead ? (
            <RtlText
              as="p"
              style={{
                margin: 0,
                fontSize: Math.min(30, height * 0.034),
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

          {/* Glass-morphism bullet cards — spring pop, staggered */}
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
                const start = BULLET_START_FRAMES[i] ?? 20 + i * 10;
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
                          fontSize: 18,
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
                          fontSize: Math.min(22, height * 0.026),
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

          {/* CTA — pop at frame 60 */}
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
                  fontSize: Math.min(30, height * 0.034),
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
    </AbsoluteFill>
  );
};
