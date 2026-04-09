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

// ─── Timing constants ─────────────────────────────────────────────────────────
const HOOK_FRAMES           = 60;
const CARD_ENTER_START      = 0;   // card scale spring begins at frame 0
const CONTENT_BASE_START    = 6;   // logo/headline start appearing after card is mostly in
const SUBHEAD_BASE_START    = 14;
const BASE_BULLET_STARTS    = [22, 32, 42];
const BASE_CTA_START        = 62;

// ─── Content column reference width (matches DF3 content area in BannerCanvas3) ─
const D3_CONTENT_W_REF = 688;

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

function luminance(r, g, b) {
  const c = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrastingTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return luminance(r, g, b) > 0.45 ? "#0f172a" : "#ffffff";
}

function RtlText({ as: Tag = "div", style, children, ...rest }) {
  return (
    <Tag
      dir="rtl"
      style={{ direction: "rtl", textAlign: "right", unicodeBidi: "isolate", ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export const defaultBannerProps3 = {
  headline:    "כותרת לדוגמה",
  background_url: "",
  subhead:     "",
  cta:         "",
  logo_url:    "",
  brand_color: "#2563eb",
  bullet_points: [],
  isVertical:  false,
  video_hook:  "",
};

/**
 * Minimalist Card design (Design 3).
 * Solid brand-colour background; all content inside an animated white card.
 */
export const Design3Composition = ({
  headline      = defaultBannerProps3.headline,
  background_url = defaultBannerProps3.background_url,   // unused visually; kept for schema parity
  subhead       = defaultBannerProps3.subhead,
  cta           = defaultBannerProps3.cta,
  logo_url      = defaultBannerProps3.logo_url,
  brand_color   = defaultBannerProps3.brand_color,
  bullet_points = defaultBannerProps3.bullet_points,
  isVertical    = false,
  video_hook    = "",
}) => {
  const frame  = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const brandHex = normalizeBrandHex(brand_color);
  const { r: br, g: bg, b: bb } = hexToRgb(brandHex);
  const ctaFg = contrastingTextColor(brandHex);

  const hasHook    = Boolean(video_hook?.trim());
  const hookOffset = hasHook ? HOOK_FRAMES : 0;

  const bullets = Array.isArray(bullet_points)
    ? bullet_points.slice(0, 3).filter((x) => typeof x === "string" && x.trim())
    : [];

  // ── Hook intro (shared with D1/D2) ──────────────────────────────────────────
  const hookTextScale = hasHook
    ? spring({ frame: Math.min(frame, HOOK_FRAMES - 1), fps, from: 0.5, to: 1,
               config: { damping: 12, stiffness: 200 } })
    : 1;

  const introSlideY = hasHook
    ? interpolate(frame, [HOOK_FRAMES - 5, HOOK_FRAMES + 5], [0, -height],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : -height;

  // ── Card entrance: scale from 0.88 → 1 with fade ────────────────────────────
  const cardLocal  = Math.max(0, frame - hookOffset - CARD_ENTER_START);
  const cardScale  = spring({ frame: cardLocal, fps, from: 0.88, to: 1,
                              config: { damping: 14, stiffness: 200 } });
  const cardOpacity = interpolate(
    frame, [hookOffset, hookOffset + 10], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // ── Logo + headline entrance ─────────────────────────────────────────────────
  const CONTENT_START = CONTENT_BASE_START + hookOffset;
  const heroOp = interpolate(frame, [CONTENT_START, CONTENT_START + 12], [0, 1],
                             { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const heroX  = interpolate(frame, [CONTENT_START, CONTENT_START + 12], [40, 0],
                             { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── Subhead ──────────────────────────────────────────────────────────────────
  const SUB_START = SUBHEAD_BASE_START + hookOffset;
  const subOp = interpolate(frame, [SUB_START, SUB_START + 12], [0, 1],
                            { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY  = interpolate(frame, [SUB_START, SUB_START + 12], [18, 0],
                            { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── CTA ──────────────────────────────────────────────────────────────────────
  const CTA_START = BASE_CTA_START + hookOffset;
  const ctaLocal  = Math.max(0, frame - CTA_START);
  const ctaScale  = spring({ frame: ctaLocal, fps, from: 0.65, to: 1,
                             config: { damping: 12, stiffness: 210 } });
  const ctaOp = interpolate(frame, [CTA_START, CTA_START + 14], [0, 1],
                            { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const BULLET_STARTS = BASE_BULLET_STARTS.map((f) => f + hookOffset);

  // ── Layout ───────────────────────────────────────────────────────────────────
  const pad = Math.round(width * 0.06);

  // Card geometry: 140px margin for square, 80/180 for vertical
  const cardMX     = isVertical ? Math.round(width * 0.074) : Math.round(width * 0.13);
  const cardMY     = isVertical ? Math.round(height * 0.094) : Math.round(height * 0.13);
  const cardW      = width  - cardMX * 2;
  const cardH      = height - cardMY * 2;
  const cardRadius = isVertical ? 36 : 28;
  const cardPad    = Math.round(cardW * 0.072);

  const contentW = cardW - cardPad * 2;

  // Font sizes scaled from D3_CONTENT_W_REF reference (matches BannerCanvas3 DF3)
  const headlineFs = Math.min(280, (contentW * (isVertical ? 88 : 62)) / D3_CONTENT_W_REF);
  const subheadFs  = Math.min(180, (contentW * (isVertical ? 38 : 24)) / D3_CONTENT_W_REF);
  const bulletFs   = Math.min(140, (contentW * (isVertical ? 28 : 18)) / D3_CONTENT_W_REF);
  const ctaFs      = Math.min(180, (contentW * (isVertical ? 44 : 28)) / D3_CONTENT_W_REF);

  const rowGap   = Math.round(cardH * 0.018);
  const bulletGap = Math.round(cardH * 0.014);

  return (
    <AbsoluteFill
      dir="rtl"
      lang="he"
      style={{
        fontFamily:  `${heebo.fontFamily}, "Segoe UI", sans-serif`,
        direction:   "rtl",
        overflow:    "hidden",
        // Solid brand-colour background
        backgroundColor: brandHex,
      }}
    >
      {/* Radial depth overlays */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `
            radial-gradient(ellipse 70% 60% at 18% 18%, rgba(255,255,255,0.18) 0%, transparent 55%),
            radial-gradient(ellipse 60% 50% at 82% 82%, rgba(0,0,0,0.14) 0%, transparent 52%)
          `,
        }}
      />

      {/* White floating card */}
      <div
        style={{
          position:        "absolute",
          left:            cardMX,
          top:             cardMY,
          width:           cardW,
          height:          cardH,
          borderRadius:    cardRadius,
          backgroundColor: "#ffffff",
          boxShadow:       "0 32px 80px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.14)",
          opacity:         cardOpacity,
          transform:       `scale(${cardScale})`,
          transformOrigin: "center center",
        }}
      />

      {/* Card content — positioned inside the card bounds */}
      <div
        style={{
          position:    "absolute",
          left:        cardMX + cardPad,
          top:         cardMY + cardPad,
          width:       contentW,
          height:      cardH - cardPad * 2,
          display:     "flex",
          flexDirection: "column",
          gap:         rowGap,
          opacity:     cardOpacity,
          transform:   `scale(${cardScale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Logo — top-right */}
        {logo_url ? (
          <div
            style={{
              alignSelf:  "flex-start",
              marginInlineStart: "auto",  // push to the right (RTL → left in DOM)
              marginBottom: rowGap,
              opacity:    heroOp,
              transform:  `translateX(${heroX}px)`,
            }}
          >
            <Img
              src={logo_url}
              style={{
                maxWidth:  Math.min(200, contentW * 0.5),
                height:    "auto",
                objectFit: "contain",
              }}
            />
          </div>
        ) : null}

        {/* Headline */}
        <RtlText
          as="h1"
          style={{
            margin:       0,
            fontSize:     headlineFs,
            fontWeight:   800,
            lineHeight:   1.12,
            color:        "#0f172a",
            letterSpacing: "-0.02em",
            opacity:      heroOp,
            transform:    `translateX(${heroX}px)`,
          }}
        >
          {headline}
        </RtlText>

        {/* Subhead */}
        {subhead ? (
          <RtlText
            as="p"
            style={{
              margin:     0,
              fontSize:   subheadFs,
              fontWeight: 400,
              lineHeight: 1.5,
              color:      "#475569",
              opacity:    subOp,
              transform:  `translateY(${subY}px)`,
            }}
          >
            {subhead}
          </RtlText>
        ) : null}

        {/* Bullet rows */}
        {bullets.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: bulletGap }}>
            {bullets.map((text, i) => {
              const start  = BULLET_STARTS[i] ?? 22 + hookOffset + i * 10;
              const local  = Math.max(0, frame - start);
              const rowPop = spring({ frame: local, fps, from: 0.82, to: 1,
                                      config: { damping: 14, stiffness: 260 } });
              const rowOp  = interpolate(local, [0, 8], [0, 1],
                                         { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

              return (
                <div
                  key={i}
                  style={{
                    opacity:         rowOp,
                    transform:       `scale(${rowPop})`,
                    transformOrigin: "center right",
                    display:         "flex",
                    flexDirection:   "row",
                    alignItems:      "center",
                    gap:             Math.round(contentW * 0.018),
                    background:      "#f8fafc",
                    border:          "1.5px solid #e2e8f0",
                    borderRadius:    12,
                    padding:         `${Math.round(cardH * 0.016)}px ${Math.round(cardH * 0.022)}px`,
                    direction:       "rtl",
                  }}
                >
                  <div
                    style={{
                      flexShrink:      0,
                      width:           Math.round(headlineFs * 0.42),
                      height:          Math.round(headlineFs * 0.42),
                      borderRadius:    8,
                      backgroundColor: brandHex,
                      color:           ctaFg,
                      display:         "flex",
                      alignItems:      "center",
                      justifyContent:  "center",
                      fontSize:        Math.round(headlineFs * 0.24),
                      fontWeight:      700,
                      boxShadow:       `0 4px 12px rgba(${br},${bg},${bb},0.35)`,
                    }}
                    aria-hidden
                  >
                    ✓
                  </div>
                  <RtlText
                    style={{
                      flex:       1,
                      fontSize:   bulletFs,
                      fontWeight: 500,
                      lineHeight: 1.45,
                      color:      "#1e293b",
                    }}
                  >
                    {text}
                  </RtlText>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* CTA */}
        {cta ? (
          <div
            style={{
              marginTop:       rowGap,
              opacity:         ctaOp,
              transform:       `scale(${ctaScale})`,
              transformOrigin: "center right",
              alignSelf:       "stretch",
            }}
          >
            <RtlText
              style={{
                display:         "block",
                padding:         `${Math.round(cardH * 0.022)}px ${cardPad}px`,
                borderRadius:    14,
                backgroundColor: brandHex,
                color:           ctaFg,
                fontWeight:      800,
                fontSize:        ctaFs,
                textAlign:       "center",
                boxShadow:       `0 12px 36px rgba(${br},${bg},${bb},0.50), 0 4px 12px rgba(0,0,0,0.18)`,
                letterSpacing:   "0.02em",
              }}
            >
              {cta}
            </RtlText>
          </div>
        ) : null}
      </div>

      {/* Whoosh fires at hook transition */}
      {hasHook && (
        <Sequence from={HOOK_FRAMES}>
          <Audio src={staticFile("whoosh.mp3")} />
        </Sequence>
      )}

      {/* Ding fires at each bullet start */}
      {bullets.map((_, i) => {
        const st = BULLET_STARTS[i] ?? 22 + hookOffset + i * 10;
        return (
          <Sequence key={`ding-${i}`} from={st}>
            <Audio src={staticFile("ding.mp3")} />
          </Sequence>
        );
      })}

      {/* Hook intro overlay — brand-colour fill, springs in, slides up at HOOK_FRAMES */}
      {hasHook && (
        <AbsoluteFill
          style={{
            backgroundColor: brandHex,
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            transform:       `translateY(${introSlideY}px)`,
            zIndex:          10,
          }}
        >
          <div
            dir="rtl"
            style={{
              fontSize:   Math.min(300, height * 0.15),
              fontWeight: 800,
              color:      ctaFg,
              textAlign:  "center",
              padding:    "0 60px",
              transform:  `scale(${hookTextScale})`,
              lineHeight: 1.2,
              textShadow: "0 4px 32px rgba(0,0,0,0.25)",
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
