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

const LEFT_RATIO = 0.44;
const HOOK_FRAMES = 60;
const BASE_BULLET_START = [18, 26, 34];
const BASE_CTA_START = 52;

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

/** Split-panel design (Design 1) — image left/top, white panel right/bottom, copy slides in */
export const Design1Composition = ({
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

  const hasHook = Boolean(video_hook?.trim());
  const hookOffset = hasHook ? HOOK_FRAMES : 0;

  const bullets = Array.isArray(bullet_points)
    ? bullet_points.slice(0, 3).filter((x) => typeof x === "string" && x.trim())
    : [];

  // Horizontal layout dimensions
  const leftW = Math.round(width * LEFT_RATIO);
  const rightW = width - leftW;
  // Vertical layout dimensions: image top 40%, text bottom 60%
  const topH = Math.round(height * 0.4);
  const bottomH = height - topH;

  const subtlePanX = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, -10],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const slideQuick = (startFrame, duration = 10) =>
    interpolate(frame, [startFrame, startFrame + duration], [56, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const fadeQuick = (startFrame, duration = 10) =>
    interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // All main-content animation timings shifted by hookOffset
  const heroX = slideQuick(2 + hookOffset, 11);
  const heroOp = fadeQuick(2 + hookOffset, 11);
  const subX = slideQuick(8 + hookOffset, 10);
  const subOp = fadeQuick(8 + hookOffset, 10);

  const BULLET_START = BASE_BULLET_START.map((f) => f + hookOffset);
  const CTA_START = BASE_CTA_START + hookOffset;

  const ctaLocal = Math.max(0, frame - CTA_START);
  const ctaPop = spring({
    frame: ctaLocal,
    fps,
    from: 0.88,
    to: 1,
    config: { damping: 14, stiffness: 220 },
  });
  const ctaOp = fadeQuick(CTA_START, 8);

  // Hook intro: spring scale entrance, then slide up and off at frame HOOK_FRAMES
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

  // Shared image panel renderer
  const renderImagePanel = (panelW, panelH, vertical) => (
    <div
      style={{
        width: panelW,
        height: panelH,
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {background_url ? (
        <div
          style={{
            position: "absolute",
            inset: -4,
            transform: `translateX(${subtlePanX}px) scale(1.02)`,
          }}
        >
          <Img
            src={background_url}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "linear-gradient(145deg, #1e293b 0%, #334155 100%)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: vertical
            ? "linear-gradient(180deg, transparent 55%, rgba(248,250,252,0.97) 100%)"
            : "linear-gradient(90deg, transparent 55%, rgba(248,250,252,0.97) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );

  // Text panel: sizes adapt to whether we're in vertical or horizontal layout
  const containerW = isVertical ? width : rightW;
  const containerH = isVertical ? bottomH : height;
  const px = Math.round(containerW * 0.08);
  const py = Math.round(containerH * 0.06);

  const renderTextPanel = () => (
    <div
      lang="he"
      style={{
        width: containerW,
        height: containerH,
        flexShrink: 0,
        background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 55%, #f1f5f9 100%)",
        boxShadow: isVertical
          ? "0 -12px 40px rgba(15,23,42,0.12)"
          : "-12px 0 40px rgba(15,23,42,0.12)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `${py}px ${px}px`,
        position: "relative",
      }}
    >
      {/* Brand accent: horizontal bar on top for vertical, vertical bar on left for horizontal */}
      <div
        style={{
          position: "absolute",
          ...(isVertical
            ? { left: "18%", right: "18%", top: 0, height: 4 }
            : { left: 0, top: "18%", bottom: "18%", width: 4 }),
          borderRadius: 2,
          background: brandHex,
          opacity: 0.9,
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        {logo_url ? (
          <div
            style={{
              marginBottom: containerH * 0.028,
              opacity: heroOp,
              transform: `translateX(${heroX}px)`,
            }}
          >
            <Img
              src={logo_url}
              style={{
                maxWidth: Math.min(200, containerW * 0.55),
                height: "auto",
                objectFit: "contain",
              }}
            />
          </div>
        ) : null}

        <RtlText
          as="h1"
          style={{
            margin: 0,
            fontSize: Math.min(68, containerH * 0.125),
            fontWeight: 800,
            lineHeight: 1.15,
            color: "#0f172a",
            opacity: heroOp,
            transform: `translateX(${heroX}px)`,
          }}
        >
          {headline}
        </RtlText>

        {subhead ? (
          <RtlText
            as="p"
            style={{
              margin: `${containerH * 0.018}px 0 0`,
              fontSize: Math.min(32, containerH * 0.068),
              fontWeight: 500,
              lineHeight: 1.5,
              color: "#475569",
              opacity: subOp,
              transform: `translateX(${subX}px)`,
            }}
          >
            {subhead}
          </RtlText>
        ) : null}

        {bullets.length > 0 ? (
          <div
            style={{
              marginTop: containerH * 0.028,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {bullets.map((text, i) => {
              const st = BULLET_START[i] ?? 18 + hookOffset + i * 8;
              const bx = slideQuick(st, 9);
              const bo = fadeQuick(st, 9);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "row-reverse",
                    alignItems: "flex-start",
                    gap: 12,
                    opacity: bo,
                    transform: `translateX(${bx}px)`,
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: brandHex,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 17,
                      fontWeight: 700,
                      marginTop: 3,
                      boxShadow: `0 4px 12px rgba(${br},${bg},${bb},0.35)`,
                    }}
                    aria-hidden
                  >
                    ✓
                  </div>
                  <RtlText
                    style={{
                      flex: 1,
                      fontSize: Math.min(27, containerH * 0.053),
                      fontWeight: 500,
                      lineHeight: 1.45,
                      color: "#1e293b",
                    }}
                  >
                    {text}
                  </RtlText>
                </div>
              );
            })}
          </div>
        ) : null}

        {cta ? (
          <div
            style={{
              marginTop: containerH * 0.036,
              opacity: ctaOp,
              transform: `translateX(${slideQuick(CTA_START, 9)}px) scale(${ctaPop})`,
              transformOrigin: "center right",
            }}
          >
            <RtlText
              style={{
                display: "block",
                padding: `${14}px ${28}px`,
                borderRadius: 12,
                backgroundColor: brandHex,
                color: "#ffffff",
                fontWeight: 800,
                fontSize: Math.min(34, containerH * 0.072),
                textAlign: "center",
                boxShadow: `0 10px 32px rgba(${br},${bg},${bb},0.4)`,
              }}
            >
              {cta}
            </RtlText>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        flexDirection: isVertical ? "column" : "row",
        display: "flex",
        backgroundColor: "#f1f5f9",
        overflow: "hidden",
        fontFamily: `${heebo.fontFamily}, "Segoe UI", sans-serif`,
      }}
    >
      {/* Image panel: top 40% for vertical, left 44% for horizontal */}
      {isVertical
        ? renderImagePanel(width, topH, true)
        : renderImagePanel(leftW, height, false)}

      {/* Text panel: bottom 60% for vertical, right 56% for horizontal */}
      {renderTextPanel()}

      {/* Whoosh sound fires exactly at the hook transition frame */}
      {hasHook && (
        <Sequence from={HOOK_FRAMES}>
          <Audio src={staticFile("whoosh.mp3")} />
        </Sequence>
      )}

      {/* Ding fires at the start frame of each feature bullet */}
      {bullets.map((_, i) => {
        const st = BULLET_START[i] ?? 18 + hookOffset + i * 8;
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
              fontSize: Math.min(168, height * 0.15),
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
