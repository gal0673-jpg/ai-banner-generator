import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", {
  weights: ["700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

/**
 * Seconds reserved at the END of the composition for the end card.
 * MUST match END_CARD_SECONDS in render.js (render.js adds this amount to
 * estimated_duration_seconds so the composition is long enough for the end card).
 */
const END_CARD_SECONDS = 3;

/**
 * Allocate ``speechFrames`` across scenes by ``spoken_text`` length so caption windows
 * track TTS pacing better than equal slices (avoids captions appearing before dialogue
 * when later scenes are longer than earlier ones).
 */
function proportionalSceneDurations(speechFrames, scenes) {
  const n = scenes.length;
  if (n === 0 || speechFrames <= 0) return [];
  if (speechFrames < n) {
    const d = Array(n).fill(0);
    for (let i = 0; i < speechFrames; i++) d[i] = 1;
    return d;
  }
  const weights = scenes.map((s) =>
    Math.max(1, String(s?.spoken_text ?? "").trim().length),
  );
  const totalW = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / totalW) * speechFrames);
  let dur = exact.map((x) => Math.max(1, Math.floor(x)));
  let sum = dur.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum > speechFrames && guard++ < 100000) {
    const j = dur.indexOf(Math.max(...dur));
    if (dur[j] <= 1) break;
    dur[j]--;
    sum--;
  }
  guard = 0;
  while (sum < speechFrames && guard++ < 100000) {
    const j = dur.indexOf(Math.max(...dur));
    dur[j]++;
    sum++;
  }
  return dur;
}

function cumulativeSceneStarts(durations) {
  const starts = [];
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    starts.push(acc);
    acc += durations[i];
  }
  return starts;
}

/**
 * On-screen URL overlay + end card.
 *
 * Behaviour:
 *   0 → speechEnd  : Small pill, top-left corner (LTR), constant position.
 *   speechEnd → end: End card — dark overlay fades in, pill springs to center
 *                    and grows to 1.6×.  The frozen last video frame shows
 *                    behind the overlay for the extra END_CARD_SECONDS added
 *                    by render.js.
 */

const PRODUCT_CENTER_POP_FRAMES = 60;

/**
 * Center “pop” for the product still: spring scale-in, then opacity fade-out.
 * `startTime` / `duration` are absolute composition frames (speech segment only).
 */
function ProductOverlay({ src, startTime, duration, brandHex }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const local = frame - startTime;
  if (local < 0 || local >= duration) {
    return null;
  }

  const entry = spring({
    frame: local,
    fps,
    from: 0,
    to: 1,
    config: { damping: 12, stiffness: 200 },
  });
  const scale = Math.min(1, interpolate(entry, [0, 1], [0, 1]));

  const fadeLen = Math.min(
    Math.round(0.35 * fps),
    Math.max(1, duration - 1),
  );
  const fadeOutStart = Math.max(0, duration - fadeLen);
  const opacity =
    duration <= 1
      ? 1
      : interpolate(local, [fadeOutStart, duration - 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 36 }}>
      {/*
       * display: "inline-flex" makes the wrapper shrink to the actual rendered image
       * dimensions (respecting maxWidth/maxHeight + auto sizing), so boxShadow on the
       * <Img> tracks the visible content rather than the full 920×920 fixed box.
       */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          display: "inline-flex",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          opacity,
        }}
      >
        <Img
          src={src}
          style={{
            maxWidth: 900,
            maxHeight: 860,
            width: "auto",
            height: "auto",
            objectFit: "contain",
            borderRadius: 20,
            border: "2px solid rgba(255,255,255,0.35)",
            boxShadow: `0 0 60px 10px ${brandHex}`,
            display: "block",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

function WebsiteUrlOverlay({
  text,
  logo_url,
  product_image_url = "",
  brandHex = "#6366f1",
  durationInFrames,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const endCardFrames = Math.max(Math.round(END_CARD_SECONDS * fps), fps);
  const endCardStart = Math.max(0, durationInFrames - endCardFrames);
  const inEndCard = frame >= endCardStart;
  const endLocal = inEndCard ? frame - endCardStart : 0;

  // Spring 0→1 that fires when end card begins
  const t = inEndCard
    ? spring({
        frame: endLocal,
        fps,
        from: 0,
        to: 1,
        config: { damping: 14, stiffness: 180 },
      })
    : 0;

  // Logo springs in 8 frames after the end card starts (lands after the URL pill)
  const logoScale = inEndCard
    ? spring({
        frame: Math.max(0, endLocal - 8),
        fps,
        from: 0,
        to: 1,
        config: { damping: 12, stiffness: 200 },
      })
    : 0;

  // Product: springs in after logo has landed (~10 frames after logo start)
  const productSpring = inEndCard && product_image_url
    ? spring({
        frame: Math.max(0, endLocal - 22),
        fps,
        from: 0,
        to: 1,
        config: { damping: 11, stiffness: 190 },
      })
    : 0;

  // Overlay darkens to rgba(0,0,0,0.75) during end card
  const overlayAlpha = interpolate(t, [0, 1], [0, 0.75]);

  // Pill anchor (LTR): during speech, center horizontally so long hostnames are not clipped
  // by the left edge; keep CY below the safe top margin. End card still eases to (CX, CY).
  const TL_CX = 1080 / 2;
  const TL_CY = 102;
  const CX = 1080 / 2;
  const CY = 1920 * 0.44;
  const cx = interpolate(t, [0, 1], [TL_CX, CX]);
  const cy = interpolate(t, [0, 1], [TL_CY, CY]);

  // Scale: pill+logo only — 2.4× zoom on end card. When a product image is present,
  // keep scale at 1 so the large product + logo + pill stack is not blown past the frame.
  const hasProduct = Boolean(product_image_url && String(product_image_url).trim());
  const scale = hasProduct
    ? interpolate(t, [0, 1], [1.0, 1.0])
    : interpolate(t, [0, 1], [1.0, 2.4]);

  // Subtle fade-in at very start so pill doesn't pop in on frame 0
  const initialOpacity = Math.min(1, frame / 5);

  const hasPill = Boolean(text && String(text).trim());
  const hasLogo = Boolean(logo_url);

  // Larger pill while the URL sits in the corner during speech; slightly smaller on end card stack.
  const pillFontSize =
    !inEndCard ? 52 : hasProduct ? 58 : 34;
  const pillPadding =
    !inEndCard ? "20px 40px" : hasProduct ? "20px 48px" : "12px 24px";
  const pillRadius = !inEndCard ? 22 : hasProduct ? 20 : 14;
  const pillMaxWidth = !inEndCard ? 1040 : hasProduct ? 1000 : 960;

  const pillBlock = hasPill ? (
    <div
      dir="ltr"
      lang="en"
      style={{
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontWeight: 700,
        fontSize: pillFontSize,
        letterSpacing: 0.5,
        color: "#FFFFFF",
        textShadow: "0 2px 14px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)",
        padding: pillPadding,
        background: "rgba(0,0,0,0.52)",
        borderRadius: pillRadius,
        border: "1px solid rgba(255,255,255,0.26)",
        whiteSpace: "nowrap",
        overflow: "visible",
        maxWidth: pillMaxWidth,
      }}
    >
      {text}
    </div>
  ) : hasLogo && hasProduct ? (
    <div style={{ width: 4, height: 4 }} aria-hidden />
  ) : hasLogo ? (
    <div style={{ width: 4, height: 4 }} aria-hidden />
  ) : null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* End-card dark overlay — transparent during speech, fades in at end */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
      />

      {/* LTR: speech pill is top-centered (TL_CX = frame center); end card eases to mid-frame. */}
      <AbsoluteFill dir="ltr" lang="en" style={{ pointerEvents: "none" }}>
        {/* With product: during speech only the pill — full column would reserve huge height. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate(${cx}px, ${cy}px) translate(-50%, -50%) scale(${scale})`,
            opacity: initialOpacity,
          }}
        >
          {hasProduct && inEndCard ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 28,
                paddingTop: 28,
                boxSizing: "border-box",
              }}
            >
              {hasLogo ? (
                <div
                  style={{
                    marginTop: 0,
                    marginBottom: 8,
                    transform: `scale(${logoScale})`,
                    transformOrigin: "center center",
                  }}
                >
                  <Img
                    src={logo_url}
                    style={{
                      maxHeight: 280,
                      maxWidth: 640,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </div>
              ) : null}
              <div
                style={{
                  display: "inline-flex",
                  maxHeight: Math.max(0, Math.ceil(productSpring * 1020)),
                  overflow: "hidden",
                  transform: `scale(${productSpring})`,
                  transformOrigin: "center center",
                  opacity: productSpring,
                }}
              >
                <Img
                  src={product_image_url}
                  style={{
                    maxWidth: 1064,
                    maxHeight: 1020,
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                    borderRadius: 24,
                    border: `2px solid ${brandHex}55`,
                    boxShadow: `0 0 56px 12px ${brandHex}99`,
                  }}
                />
              </div>
              {pillBlock ? (
                <div style={{ marginTop: 40 }}>{pillBlock}</div>
              ) : null}
            </div>
          ) : (
            <div style={{ position: "relative", display: "inline-block" }}>
              {hasLogo && !hasProduct ? (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: "50%",
                    transform: `translateX(-50%) scale(${logoScale})`,
                    transformOrigin: "center bottom",
                    marginBottom: 30,
                  }}
                >
                  <Img
                    src={logo_url}
                    style={{
                      maxHeight: 140,
                      maxWidth: 400,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </div>
              ) : null}
              {pillBlock}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function RtlText({ style, children }) {
  return (
    <div
      dir="rtl"
      lang="he"
      style={{
        direction: "rtl",
        textAlign: "center",
        unicodeBidi: "isolate",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * TikTok-style caption: strong spring pop-in + slide-up + fade.
 * Timing: only the first ~18–22 frames of each scene (~0.6–0.75s @ 30fps) —
 * if you seek to the middle of a scene the text already looks “static”.
 */
function CaptionLayer({ text, fps, brandHex = "#6366f1" }) {
  const frame = useCurrentFrame();

  // Big entrance: small → full (was 0.55, too subtle on export)
  const scale = spring({
    frame,
    fps,
    from: 0.35,
    to: 1,
    config: { damping: 11, stiffness: 200 },
  });

  // Visible overshoot: “bounce” settle (1.22 → 1.0)
  const bounce = spring({
    frame,
    fps,
    from: 1.22,
    to: 1.0,
    config: { damping: 9, stiffness: 280 },
  });

  const opacity = Math.min(1, frame / 6);

  // Slide up from below (pixels) — reads clearly even at 1080×1920
  const slideUp = interpolate(frame, [0, 10], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 2),
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 168,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${slideUp}px) scale(${scale * bounce})`,
          opacity,
          transformOrigin: "center bottom",
        }}
      >
        <RtlText
          style={{
            fontFamily: `${fontFamily}, "Segoe UI", sans-serif`,
            fontWeight: 800,
            fontSize: 84,
            color: "#FFFFFF",
            textShadow: [
              "0 2px 12px rgba(0,0,0,0.95)",
              "0 0 4px rgba(0,0,0,1)",
              `0 0 32px ${brandHex}`,
              `0 0 16px ${brandHex}`,
            ].join(", "),
            lineHeight: 1.3,
            letterSpacing: -0.5,
            padding: "14px 48px",
            background: "rgba(0,0,0,0.48)",
            borderRadius: 22,
            WebkitTextStroke: "0.5px rgba(255,255,255,0.15)",
          }}
        >
          {text}
        </RtlText>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Main UGC composition — 1080×1920 portrait (TikTok/Reels format).
 *
 * Props:
 *   raw_video_url  — Full URL to the HeyGen/D-ID avatar video (CDN or local).
 *   ugc_script     — Validated script object from ugc_director.py:
 *                    { estimated_duration_seconds, scenes: [{ on_screen_text, … }] }
 *   bgm_url        — Optional remote/custom audio URL (http(s) or resolved asset).
 *   bundled_bgm    — When true and bgm_url is empty, plays video_engine/public/bgm.mp3
 *                    via Remotion staticFile() (required for renderMedia — do not pass
 *                    filesystem paths from Node; bundle() serveUrl is not an http URL).
 *   website_display — Optional hostname for branded URL pill (no https/www). Shown
 *                    top-left (LTR) for the clip, then springs toward center in the
 *                    last ~2.75s.
 *   product_image_url — Optional product image: “center pop” ~2s around speech midpoint,
 *                    plus end-card stack (below logo, above URL pill) when overlay is shown.
 *
 * Architecture note:
 *   FFmpeg runs BEFORE Remotion and already produces a 1080×1920 9:16 video with blurred
 *   background fill (ugc_composited.mp4).  worker_tasks.py passes that file as raw_video_url
 *   so Remotion only needs ONE OffthreadVideo decode per frame instead of two.
 *   This halves render time compared to having Remotion also re-blur the background.
 *
 * Visual layers (bottom → top):
 *   1. Foreground video  — FFmpeg-composited (already 9:16 blur-bg) + Ken Burns + scene punch.
 *   2. Cinematic gradient — top+bottom dark bars for broadcast-TV depth.
 *   3. URL overlay        — hostname pill top-left → center end-card spring (+ logo/product).
 *   4. Product center pop — optional 2s window around speech midpoint.
 *   5. Caption layers     — per-scene, spring pop-in + pill background.
 *   6. BGM audio          — volume 0.15, looped.
 */
export function UgcComposition({
  raw_video_url = "",
  ugc_script = null,
  bgm_url = "",
  bundled_bgm = false,
  website_display = "",
  logo_url = "",
  product_image_url = "",
  brand_hex = "#6366f1",
}) {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // Sanitise brand colour — fall back to indigo if the prop is empty/absent
  const brandHex =
    typeof brand_hex === "string" && /^#[0-9A-Fa-f]{3,8}$/.test(brand_hex.trim())
      ? brand_hex.trim()
      : "#6366f1";

  const trimmedBgm =
    typeof bgm_url === "string" ? bgm_url.trim() : "";
  const bgmSrc = trimmedBgm
    ? trimmedBgm
    : bundled_bgm
      ? staticFile("bgm.mp3")
      : null;

  const websiteText =
    typeof website_display === "string" ? website_display.trim() : "";

  const productImg =
    typeof product_image_url === "string" ? product_image_url.trim() : "";

  const scenes = Array.isArray(ugc_script?.scenes) ? ugc_script.scenes : [];
  const numScenes = Math.max(1, scenes.length);

  // Speech frames = total minus the end-card portion added by render.js.
  // Ken Burns zoom and captions are bounded to speech frames so they don't
  // animate weirdly under the end-card overlay.
  const endCardFrames = Math.round(END_CARD_SECONDS * fps);
  const speechFrames = Math.max(fps, durationInFrames - endCardFrames);
  const sceneDurations = proportionalSceneDurations(speechFrames, scenes);
  const sceneStarts = cumulativeSceneStarts(sceneDurations);

  // Midpoint of speech (excluding end card) — product “center pop” is 60 frames centered here.
  const speechMidFrame = Math.floor(speechFrames / 2);
  const halfPop = Math.floor(PRODUCT_CENTER_POP_FRAMES / 2);
  const productPopStart = Math.max(0, speechMidFrame - halfPop);
  const productPopDuration = Math.min(
    PRODUCT_CENTER_POP_FRAMES,
    Math.max(0, speechFrames - productPopStart),
  );

  // ── Continuous floating camera (no per-scene hiccups) ────────────────────
  // Single entrance punch at the very beginning of the video
  const globalPunch = spring({
    frame,
    fps,
    from: 0.95,
    to: 1.0,
    config: { damping: 14, stiffness: 200 },
  });

  // Continuous slow zoom across the entire video
  const globalZoom = interpolate(frame, [0, durationInFrames], [1.06, 1.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Gentle, random-feeling cinematic float using sine/cosine waves
  const panX = Math.sin(frame / 60) * 22;
  const panY = Math.cos(frame / 45) * 14;

  // Full-scale: entrance punch × continuous slow zoom
  const videoScale = globalZoom * globalPunch;

  // Progress bar: 0 → 100% across the full composition duration
  const progressWidth = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {raw_video_url ? (
        <>
          {/* ── Layer 1: Video — continuous float + entrance punch ────────────── */}
          {/* Input is already a 9:16 blur-bg composited file (FFmpeg output).  */}
          {/* ONE OffthreadVideo only — halves render time vs double-decode.     */}
          <AbsoluteFill
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${videoScale})`,
              transformOrigin: "center center",
              overflow: "hidden",
            }}
          >
            <OffthreadVideo
              src={raw_video_url}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </AbsoluteFill>

          {/* ── Layer 2: Cinematic gradient ───────────────────────────────── */}
          <AbsoluteFill
            style={{
              background: [
                "linear-gradient(180deg,",
                "rgba(0,0,0,0.15) 0%,",
                "transparent 20%,",
                "transparent 65%,",
                "rgba(0,0,0,0.75) 100%)",
              ].join(" "),
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        // Studio preview placeholder — no video URL supplied
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          }}
        />
      )}

      {/* ── Layer 4a: Product center pop (~2s around speech midpoint) ─────── */}
      {productImg && productPopDuration > 0 ? (
        <ProductOverlay
          src={productImg}
          startTime={productPopStart}
          duration={productPopDuration}
          brandHex={brandHex}
        />
      ) : null}

      {/* ── Layer 4b: Website URL + end-card logo / product (above captions) ─ */}
      {websiteText || logo_url || productImg ? (
        <WebsiteUrlOverlay
          text={websiteText}
          logo_url={logo_url}
          product_image_url={productImg}
          brandHex={brandHex}
          durationInFrames={durationInFrames}
        />
      ) : null}

      {/* ── Layer 5: Per-scene captions (stop at speechFrames, not durationInFrames) */}
      {scenes.map((scene, i) => {
        if (!scene?.on_screen_text?.trim()) return null;

        const startFrame = sceneStarts[i] ?? 0;
        const sceneDuration = Math.max(
          1,
          sceneDurations[i] ?? Math.floor(speechFrames / numScenes),
        );

        const hasPunctuation = /[.!?]$/.test(
          scene.on_screen_text?.trim() || "",
        );
        const shouldPlayDing = i === 0 || hasPunctuation;

        return (
          <Sequence key={i} from={startFrame} durationInFrames={sceneDuration}>
            {shouldPlayDing && (
              <Audio src={staticFile("ding.mp3")} volume={0.4} />
            )}
            <CaptionLayer text={scene.on_screen_text} fps={fps} brandHex={brandHex} />
          </Sequence>
        );
      })}

      {/* ── Layer 5b: Progress bar — thick track + inset fill so it reads on export & web preview */}
      <AbsoluteFill style={{ pointerEvents: "none", zIndex: 250 }}>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: 20,
            backgroundColor: "rgba(0,0,0,0.62)",
            borderTop: "2px solid rgba(255,255,255,0.18)",
            boxShadow: "0 -6px 24px rgba(0,0,0,0.5)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: `${progressWidth}%`,
              height: "100%",
              borderRadius: 3,
              backgroundColor: brandHex,
              boxShadow: `0 0 14px 3px ${brandHex}`,
            }}
          />
        </div>
      </AbsoluteFill>

      {/* ── Layer 6a: End-card whoosh — plays exactly when end card begins */}
      <Sequence from={durationInFrames - endCardFrames}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.8} />
      </Sequence>

      {/* ── Layer 6b: Background music ─────────────────────────────────────── */}
      {bgmSrc ? <Audio src={bgmSrc} volume={0.15} loop /> : null}
    </AbsoluteFill>
  );
}

export const defaultUgcProps = {
  raw_video_url: "",
  ugc_script: {
    estimated_duration_seconds: 30,
    scenes: [
      {
        scene_number: 1,
        spoken_text: "תקשיבו... אתם לא הולכים להאמין למה שגיליתי.",
        on_screen_text: "רגע, זה אמיתי?",
        visual_layout: "full_avatar",
      },
      {
        scene_number: 2,
        spoken_text: "המוצר הזה שינה לי את החיים, באמת.",
        on_screen_text: "שינוי אמיתי",
        visual_layout: "avatar_with_bullets",
      },
      {
        scene_number: 3,
        spoken_text: "אז מה אתם מחכים... כנסו עכשיו!",
        on_screen_text: "כנסו עכשיו!",
        visual_layout: "avatar_with_cta",
      },
    ],
  },
  bgm_url: "",
  bundled_bgm: true,
  website_display: "",
  logo_url: "",
  product_image_url: "",
};
