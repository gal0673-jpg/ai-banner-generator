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
import { loadFont as loadAssistantFont } from "@remotion/google-fonts/Assistant";
import { loadFont as loadHeeboFont } from "@remotion/google-fonts/Heebo";
import { loadFont as loadRubikFont } from "@remotion/google-fonts/Rubik";

const heeboLoaded = loadHeeboFont("normal", {
  weights: ["700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

const rubikLoaded = loadRubikFont("normal", {
  weights: ["700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

const assistantLoaded = loadAssistantFont("normal", {
  weights: ["700", "800"],
  subsets: ["hebrew", "latin", "latin-ext"],
});

/**
 * @param {string | undefined} fontKey — 'heebo' | 'rubik' | 'assistant'
 * @returns {string} CSS font-family stack
 */
function resolveCaptionFontFamily(fontKey) {
  const k = typeof fontKey === "string" ? fontKey.toLowerCase().trim() : "heebo";
  if (k === "rubik") return rubikLoaded.fontFamily;
  if (k === "assistant") return assistantLoaded.fontFamily;
  return heeboLoaded.fontFamily;
}

/** Frames per typed character for typewriter animation (see CaptionLayer). */
const TYPEWRITER_FRAMES_PER_CHAR = 2;

/** @param {"top"|"center"|"bottom"} position @param {number} height composition height */
function getCaptionFillStyle(position, height) {
  const edgePad = Math.max(80, height * 0.1);
  const base = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    pointerEvents: "none",
  };
  if (position === "top") {
    return {
      ...base,
      justifyContent: "flex-start",
      paddingTop: edgePad,
      paddingBottom: 0,
    };
  }
  if (position === "center") {
    return {
      ...base,
      justifyContent: "center",
      paddingTop: 0,
      paddingBottom: 0,
    };
  }
  return {
    ...base,
    justifyContent: "flex-end",
    paddingBottom: edgePad,
    paddingTop: 0,
  };
}

function captionTransformOrigin(position) {
  if (position === "top") return "center top";
  if (position === "center") return "center center";
  return "center bottom";
}

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
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 100 }}>
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
  aspect_ratio = "9:16",
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

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

  const ar =
    typeof aspect_ratio === "string" ? aspect_ratio.trim() : "9:16";
  const is169 = ar === "16:9";

  // Pill anchor (LTR): during speech, center horizontally so long hostnames are not clipped
  // by the left edge; keep CY below the safe top margin. End card still eases to (CX, CY).
  // 16:9 landscape: vertical room is limited — use true vertical center; 9:16 / 1:1 unchanged.
  const TL_CX = width / 2;
  const TL_CY = height * (102 / 1920);
  const CX = width / 2;
  const CY = is169 ? height * 0.5 : height * 0.44;
  const cx = interpolate(t, [0, 1], [TL_CX, CX]);
  const cy = interpolate(t, [0, 1], [TL_CY, CY]);

  // Scale: pill+logo only — end-card zoom (2.4× portrait/square; smaller on 16:9). When a
  // product image is present, keep scale at 1 so the large product + logo + pill stack is
  // not blown past the frame.
  const hasProduct = Boolean(product_image_url && String(product_image_url).trim());
  // 16:9 landscape: must stay inside ~1080px height; 2.4× or a 1020px-tall product blows the frame.
  const endCardNoProductScale = is169 ? 1.2 : 2.4;
  const scale = hasProduct
    ? interpolate(t, [0, 1], [1.0, 1.0])
    : interpolate(t, [0, 1], [1.0, endCardNoProductScale]);

  // End-card product column: 9:16 / 1:1 keep existing caps; 16:9 uses a strict vertical budget.
  const productEndMaxH = is169 ? Math.min(480, Math.floor(height * 0.44)) : 1020;
  const productEndMaxW = is169 ? Math.min(960, width - 40) : 1064;
  const logoEndMaxH = is169 ? 100 : 280;
  const logoEndMaxW = is169 ? 420 : 640;

  // Subtle fade-in at very start so pill doesn't pop in on frame 0
  const initialOpacity = Math.min(1, frame / 5);

  const hasPill = Boolean(text && String(text).trim());
  const hasLogo = Boolean(logo_url);

  // Larger pill while the URL sits in the corner during speech; slightly smaller on end card stack.
  const pillFontSize =
    !inEndCard ? 52 : hasProduct ? (is169 ? 46 : 58) : 34;
  const pillPadding =
    !inEndCard
      ? "20px 40px"
      : hasProduct
        ? is169
          ? "14px 28px"
          : "20px 48px"
        : "12px 24px";
  const pillRadius = !inEndCard ? 22 : hasProduct ? 20 : 14;
  const pillMaxWidth = !inEndCard ? 1040 : hasProduct ? (is169 ? 880 : 1000) : 960;

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
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 30 }}>
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
                gap: is169 ? 8 : 28,
                paddingTop: is169 ? 0 : 28,
                boxSizing: "border-box",
              }}
            >
              {hasLogo ? (
                <div
                  style={{
                    marginTop: 0,
                    marginBottom: is169 ? 4 : 8,
                    transform: `scale(${logoScale})`,
                    transformOrigin: "center center",
                  }}
                >
                  <Img
                    src={logo_url}
                    style={{
                      maxHeight: logoEndMaxH,
                      maxWidth: logoEndMaxW,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </div>
              ) : null}
              <div
                style={{
                  display: "inline-flex",
                  maxHeight: Math.max(
                    0,
                    Math.ceil(productSpring * productEndMaxH),
                  ),
                  overflow: "hidden",
                  transform: `scale(${productSpring})`,
                  transformOrigin: "center center",
                  opacity: productSpring,
                }}
              >
                <Img
                  src={product_image_url}
                  style={{
                    maxWidth: productEndMaxW,
                    maxHeight: productEndMaxH,
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
                <div style={{ marginTop: is169 ? 10 : 40 }}>{pillBlock}</div>
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
 * TikTok-style caption with optional style prefs (`ugc_script.style`).
 * Timing: entrance animates in the first frames of each scene sequence.
 */
function CaptionLayer({ text, brandHex = "#6366f1", stylePrefs = {} }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const position =
    stylePrefs.position === "top" ||
    stylePrefs.position === "center" ||
    stylePrefs.position === "bottom"
      ? stylePrefs.position
      : "bottom";

  const animation =
    stylePrefs.animation === "fade" || stylePrefs.animation === "typewriter"
      ? stylePrefs.animation
      : "pop";

  const fontFamilyStr = resolveCaptionFontFamily(
    typeof stylePrefs.font === "string" ? stylePrefs.font : "heebo",
  );

  const origin = captionTransformOrigin(position);
  const fillStyle = getCaptionFillStyle(position, height);

  const raw = String(text ?? "");
  const displayText =
    animation === "typewriter"
      ? raw.substring(
          0,
          Math.min(raw.length, Math.floor(frame / TYPEWRITER_FRAMES_PER_CHAR)),
        )
      : raw;

  let innerStyle;

  if (animation === "pop") {
    const scale = spring({
      frame,
      fps,
      from: 0.35,
      to: 1,
      config: { damping: 11, stiffness: 200 },
    });
    const bounce = spring({
      frame,
      fps,
      from: 1.22,
      to: 1.0,
      config: { damping: 9, stiffness: 280 },
    });
    const opacity = Math.min(1, frame / 6);
    const slideUp = interpolate(frame, [0, 10], [36, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 2),
    });
    innerStyle = {
      transform: `translateY(${slideUp}px) scale(${scale * bounce})`,
      opacity,
      transformOrigin: origin,
    };
  } else if (animation === "fade") {
    const opacity = interpolate(frame, [0, 18], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 2),
    });
    const slideFrom = position === "top" ? -26 : 26;
    const slideUp = interpolate(frame, [0, 18], [slideFrom, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => 1 - Math.pow(1 - t, 2),
    });
    innerStyle = {
      transform: `translateY(${slideUp}px)`,
      opacity,
      transformOrigin: origin,
    };
  } else {
    const opacity = Math.min(1, frame / 5);
    innerStyle = {
      transform: "none",
      opacity,
      transformOrigin: origin,
    };
  }

  const textStyle = {
    fontFamily: `${fontFamilyStr}, "Segoe UI", sans-serif`,
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
  };

  return (
    <AbsoluteFill style={fillStyle}>
      <div style={innerStyle}>
        <RtlText style={textStyle}>{displayText}</RtlText>
      </div>
    </AbsoluteFill>
  );
}

/** Ken Burns + float when a URL exists; else studio-style gradient. */
function StudioNoVideoBackground() {
  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      }}
    />
  );
}

/**
 * @param {object} p
 * @param {string} p.rawVideoUrl
 * @param {number} p.videoPanX
 * @param {number} p.videoPanY
 * @param {number} p.videoScale
 * @param {React.ReactNode} [p.children] — e.g. vignette / masks, painted above the video, below tracks above this layer
 */
function KenBurnsAvatarVideo({ rawVideoUrl, videoPanX, videoPanY, videoScale, children }) {
  const src = typeof rawVideoUrl === "string" ? rawVideoUrl.trim() : "";
  if (!src) {
    return <StudioNoVideoBackground />;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `translate(${videoPanX}px, ${videoPanY}px) scale(${videoScale})`,
          transformOrigin: "center center",
          overflow: "hidden",
        }}
      >
        <OffthreadVideo
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      {children}
    </AbsoluteFill>
  );
}

function CinematicVignetteGradient() {
  return (
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
  );
}

/**
 * Subtle darkening on the right half (LTR) where the bullet caption column sits, for legibility.
 */
function BulletColumnReadabilityMask() {
  return (
    <AbsoluteFill
      style={{
        left: "50%",
        width: "50%",
        background:
          "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 18%, rgba(0,0,0,0.5) 100%)",
        pointerEvents: "none",
      }}
    />
  );
}

// --- Pippable full-duration avatar (Layer 1; grid sits below, zIndex 1) ------------

const PIP_SPRING = { damping: 17, stiffness: 128 };

/** Shared metrics: 2×2 grid (gap + padding) so image cells and BR video align. */
function getSplitGalleryCellMetrics(width, height) {
  const gap = 10;
  const pad = 12;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const cellW = (innerW - gap) / 2;
  const cellH = (innerH - gap) / 2;
  const brLeft = pad + cellW + gap;
  const brTop = pad + cellH + gap;
  return { pad, gap, cellW, cellH, brLeft, brTop };
}

/**
 * 0 = full-bleed Ken Burns; 1 = avatar clipped to the split_gallery bottom-right cell
 * (same box as the 2×2 grid’s BR slot — `getSplitGalleryCellMetrics`).
 */
function PippableAvatarVideo({
  rawVideoUrl,
  videoPanX,
  videoPanY,
  videoScale,
  pipWeight,
  speechFrames,
}) {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const src = typeof rawVideoUrl === "string" ? rawVideoUrl.trim() : "";
  const mix = frame >= speechFrames ? 0 : Math.min(1, Math.max(0, pipWeight));
  const kinK = 1 - mix;
  const panX = videoPanX * kinK;
  const panY = videoPanY * kinK;

  if (!src) {
    return <StudioNoVideoBackground />;
  }

  if (mix < 0.001) {
    return (
      <AbsoluteFill style={{ zIndex: 2, pointerEvents: "none" }}>
        <KenBurnsAvatarVideo
          rawVideoUrl={rawVideoUrl}
          videoPanX={videoPanX}
          videoPanY={videoPanY}
          videoScale={videoScale}
        >
          <CinematicVignetteGradient />
        </KenBurnsAvatarVideo>
      </AbsoluteFill>
    );
  }

  const { brLeft, brTop, cellW, cellH } = getSplitGalleryCellMetrics(width, height);
  const left = interpolate(mix, [0, 1], [0, brLeft]);
  const top = interpolate(mix, [0, 1], [0, brTop]);
  const w = interpolate(mix, [0, 1], [width, cellW]);
  const h = interpolate(mix, [0, 1], [height, cellH]);
  const brR = interpolate(mix, [0, 1], [0, 10]);
  const bW = interpolate(mix, [0, 1], [0, 2]);
  const bA = interpolate(mix, [0, 1], [0, 0.85]);
  const sh = interpolate(mix, [0, 1], [0, 0.5]);
  const vigOpacity = interpolate(mix, [0, 0.45], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ zIndex: 2, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: h,
          borderRadius: brR,
          border: `${bW}px solid rgba(255,255,255,${bA})`,
          boxShadow:
            sh > 0.01
              ? `0 10px 32px rgba(0,0,0,${sh}), 0 0 0 1px rgba(0,0,0,0.25)`
              : "none",
          overflow: "hidden",
          backgroundColor: "#0a0a0a",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `translate(${panX}px, ${panY}px) scale(${videoScale})`,
            transformOrigin: "center center",
          }}
        >
          <OffthreadVideo
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      </div>
      {vigOpacity > 0.01 ? (
        <AbsoluteFill
          style={{
            opacity: vigOpacity,
            pointerEvents: "none",
          }}
        >
          <CinematicVignetteGradient />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}

const GRID_STAGGER_FRAMES = 4;

function normalizeToFourImageSlots(images) {
  const arr = Array.isArray(images) ? images : [];
  const out = ["", "", "", ""];
  for (let k = 0; k < 4; k += 1) {
    const v = arr[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : `תמונה ${k + 1}`;
  }
  return out;
}

/** Up to 3 labels for TL, TR, BL (BR is the live avatar). */
function normalizeToThreeGalleryImageSlots(images) {
  const arr = Array.isArray(images) ? images : [];
  const out = ["", "", ""];
  for (let k = 0; k < 3; k += 1) {
    const v = arr[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : `תמונה ${k + 1}`;
  }
  return out;
}

/** Up to 3 optional HTTP URLs for DALL·E (same slot order as `images`). */
function normalizeToThreeGalleryImageUrls(urls) {
  const arr = Array.isArray(urls) ? urls : [];
  const out = ["", "", ""];
  for (let k = 0; k < 3; k += 1) {
    const v = arr[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : "";
  }
  return out;
}

function galleryCellPlaceholderStyle(description, index, brandHex) {
  const s = String(description ?? "");
  let h = (index + 1) * 199;
  for (let j = 0; j < s.length; j += 1) {
    h = (h * 33 + s.charCodeAt(j) * (j + 3) + (index + 1) * 17) % 2000000;
  }
  const hue = h % 360;
  const hue2 = (hue + 48 + ((index * 17) % 40)) % 360;
  return {
    background: `linear-gradient(150deg, 
      hsla(${hue}, 38%, 18%, 0.94) 0%,
      hsla(${hue2}, 32%, 12%, 0.97) 100%)`,
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.1)",
      "0 8px 28px rgba(0,0,0,0.55)",
      `0 0 20px -4px ${brandHex}33`,
    ].join(", "),
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(8px)",
    color: "rgba(255,255,255,0.92)",
    textShadow: "0 2px 12px rgba(0,0,0,0.9)",
  };
}

/**
 * Full-frame 2×2 grid: `layout_data.images` → top-left, top-right, bottom-left only;
 * bottom-right is reserved for the `OffthreadVideo` layer.
 * Optional `layout_data.image_urls` (3 URLs) — DALL·E stills with Ken Burns + Hebrew caption band.
 */
function PipGalleryGrid({
  layoutData,
  brandHex,
  continueGalleryRun = false,
  sceneDurationInFrames = 90,
}) {
  const localT = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { pad, gap } = getSplitGalleryCellMetrics(width, height);
  const imageDescriptions = normalizeToThreeGalleryImageSlots(layoutData?.images);
  const imageUrls = normalizeToThreeGalleryImageUrls(layoutData?.image_urls);
  const fontFamilyStr = resolveCaptionFontFamily("heebo");
  const sceneLen = Math.max(1, sceneDurationInFrames);
  const slots = [
    { desc: imageDescriptions[0], imageUrl: imageUrls[0], gridColumn: 1, gridRow: 1, index: 0 },
    { desc: imageDescriptions[1], imageUrl: imageUrls[1], gridColumn: 2, gridRow: 1, index: 1 },
    { desc: imageDescriptions[2], imageUrl: imageUrls[2], gridColumn: 1, gridRow: 2, index: 2 },
  ];
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundColor: "#0a0a0a",
        boxSizing: "border-box",
        padding: pad,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap,
      }}
    >
      {slots.map(({ desc, imageUrl, gridColumn, gridRow, index: i }) => {
        const t = localT - i * GRID_STAGGER_FRAMES;
        const entry = continueGalleryRun
          ? 1
          : t < 0
            ? 0
            : spring({
                frame: t,
                fps,
                from: 0,
                to: 1,
                config: { damping: 15, stiffness: 160 },
              });
        const scale = interpolate(entry, [0, 1], [0.88, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const op = interpolate(entry, [0, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = continueGalleryRun
          ? 0
          : interpolate(
              t,
              [0, 12 + i * 2],
              [20, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
        const ph = galleryCellPlaceholderStyle(desc, i, brandHex);
        const hasRaster = Boolean(imageUrl);
        const kenBurnsScale = interpolate(
          localT,
          [0, Math.max(1, sceneLen - 1)],
          [1, 1.08],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <div
            key={`g-${gridColumn}-${gridRow}`}
            style={{
              ...(hasRaster
                ? {
                    backgroundColor: "#141414",
                    boxShadow: ph.boxShadow,
                    border: ph.border,
                  }
                : ph),
              gridColumn,
              gridRow,
              minHeight: 0,
              minWidth: 0,
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: hasRaster ? "flex-end" : "center",
              textAlign: "center",
              padding: hasRaster ? 0 : 10,
              transform: `translateY(${y}px) scale(${scale})`,
              opacity: op,
              overflow: "hidden",
              position: "relative",
            }}
          >
            {hasRaster ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    borderRadius: 12,
                  }}
                >
                  <Img
                    src={imageUrl}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      transform: `scale(${kenBurnsScale})`,
                      transformOrigin: "50% 50%",
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: "52%",
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 45%, transparent 100%)",
                    borderRadius: "0 0 12px 12px",
                    pointerEvents: "none",
                  }}
                />
                <span
                  dir="rtl"
                  lang="he"
                  style={{
                    position: "relative",
                    zIndex: 2,
                    fontFamily: `${fontFamilyStr}, "Segoe UI", sans-serif`,
                    fontSize: Math.min(22, height * 0.018),
                    fontWeight: 700,
                    lineHeight: 1.25,
                    wordBreak: "break-word",
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 15,
                    color: "rgba(255,255,255,0.95)",
                    textShadow: "0 2px 14px rgba(0,0,0,0.9)",
                  }}
                >
                  {desc}
                </span>
              </>
            ) : (
              <span
                style={{
                  fontFamily: `${fontFamilyStr}, "Segoe UI", sans-serif`,
                  fontSize: Math.min(22, height * 0.018),
                  fontWeight: 700,
                  lineHeight: 1.25,
                  wordBreak: "break-word",
                  padding: 10,
                }}
              >
                {desc}
              </span>
            )}
          </div>
        );
      })}
      <div
        style={{
          gridColumn: 2,
          gridRow: 2,
          minHeight: 0,
          minWidth: 0,
          borderRadius: 10,
          backgroundColor: "rgba(0,0,0,0.35)",
        }}
        aria-hidden
      />
    </AbsoluteFill>
  );
}

/**
 * `split_gallery` captions: lower-third / TikTok-style (never top — keeps URL pill clear).
 * Sits over the bottom row of the 2×2 (BL cell + BR avatar) with slight overlap.
 * When `continueGalleryRun`, skip entrance (caption swaps without re-animating the band).
 */
function PipGalleryLayout({ text, brandHex, stylePrefs = {}, continueGalleryRun = false }) {
  const localT = useCurrentFrame();
  const { fps, width: compWidth, height } = useVideoConfig();
  const fontFamilyStr = resolveCaptionFontFamily(
    typeof stylePrefs.font === "string" ? stylePrefs.font : "heebo",
  );
  const hasText = Boolean(text && String(text).trim());
  if (!hasText) {
    return null;
  }
  const textEnter = continueGalleryRun
    ? 1
    : Math.min(1, spring({
        frame: localT,
        fps,
        from: 0,
        to: 1,
        config: { damping: 16, stiffness: 140 },
      }));
  const slideY = continueGalleryRun
    ? 0
    : interpolate(localT, [0, 12], [18, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        zIndex: 1,
        justifyContent: "flex-end",
        alignItems: "center",
        display: "flex",
        paddingLeft: "4%",
        paddingRight: "4%",
        /* Above progress bar, overlapping lower half of bottom row of grid */
        paddingBottom: Math.max(88, height * 0.1),
        boxSizing: "border-box",
      }}
    >
      <div
        dir="rtl"
        lang="he"
        style={{
          maxWidth: "96%",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          paddingBottom: "2%",
        }}
      >
        <div
          style={{
            maxWidth: 920,
            width: "100%",
            opacity: textEnter,
            transform: `translateY(${slideY}px)`,
          }}
        >
          <div
            style={{
              fontFamily: `${fontFamilyStr}, "Segoe UI", sans-serif`,
              fontWeight: 800,
              fontSize: Math.min(64, compWidth * 0.05),
              lineHeight: 1.2,
              color: "#fff",
              textAlign: "center",
              padding: "14px 20px",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: [
                "0 10px 36px rgba(0,0,0,0.6)",
                `0 0 0 1px ${brandHex}22`,
                `0 0 28px ${brandHex}40`,
              ].join(", "),
              textShadow: [
                "0 2px 16px rgba(0,0,0,0.95)",
                `0 0 20px ${brandHex}55`,
              ].join(", "),
            }}
          >
            {String(text).trim()}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function BulletPointsLayout({ text, brandHex, stylePrefs = {} }) {
  const showCap = Boolean(text && String(text).trim());
  return (
    <>
      <BulletColumnReadabilityMask />
      {showCap ? (
        <AbsoluteFill
          style={{
            left: "50%",
            width: "50%",
          }}
        >
          <CaptionLayer text={text} brandHex={brandHex} stylePrefs={stylePrefs} />
        </AbsoluteFill>
      ) : null}
    </>
  );
}

function resolveSceneLayoutName(scene) {
  const raw = scene?.visual_layout;
  if (typeof raw !== "string" || !raw.trim()) return "full_avatar";
  return raw.trim().toLowerCase();
}

/** True when this scene continues a run of consecutive `split_gallery` scenes. */
function isConsecutiveSplitGalleryScene(scenes, index) {
  if (index <= 0) return false;
  return (
    resolveSceneLayoutName(scenes[index - 1]) === "split_gallery"
    && resolveSceneLayoutName(scenes[index]) === "split_gallery"
  );
}

function getSceneIndexForFrame(f, sceneStarts, sceneDurations) {
  const n = sceneStarts.length;
  if (n === 0) return 0;
  for (let i = 0; i < n; i += 1) {
    const end = sceneStarts[i] + sceneDurations[i];
    if (f >= sceneStarts[i] && f < end) {
      return i;
    }
  }
  return n - 1;
}

/**
 * 0 = full-bleed avatar; 1 = PiP in the BR cell.
 * Springs in only when **entering** a gallery after a non-gallery scene; holds at 1 across
 * consecutive `split_gallery` scenes; springs out when leaving to a non-gallery layout.
 */
function getPipWeight(frame, fps, speechFrames, sceneStarts, sceneDurations, scenes) {
  if (frame < 0) return 0;
  if (frame >= speechFrames) return 0;
  const i = getSceneIndexForFrame(frame, sceneStarts, sceneDurations);
  const start = sceneStarts[i] ?? 0;
  const t = frame - start;
  const isGallery = resolveSceneLayoutName(scenes[i]) === "split_gallery";
  const prevIsGallery = i > 0 && resolveSceneLayoutName(scenes[i - 1]) === "split_gallery";
  const s = Math.min(1, spring({ frame: t, fps, from: 0, to: 1, config: PIP_SPRING }));
  if (isGallery) {
    if (prevIsGallery) {
      return 1;
    }
    return s;
  }
  if (i > 0 && prevIsGallery) {
    return 1 - s;
  }
  return 0;
}

/** One scene’s caption / layout UI (per <Sequence/>), matching `visual_layout`. */
function SceneLayoutContent({
  scene,
  brandHex,
  stylePrefs = {},
  continuesConsecutiveSplitGallery = false,
}) {
  const text = scene?.on_screen_text ?? "";
  const layout = resolveSceneLayoutName(scene);
  switch (layout) {
    case "split_gallery":
      return (
        <PipGalleryLayout
          text={text}
          brandHex={brandHex}
          stylePrefs={stylePrefs}
          continueGalleryRun={continuesConsecutiveSplitGallery}
        />
      );
    case "avatar_with_bullets":
      return (
        <BulletPointsLayout
          text={text}
          brandHex={brandHex}
          stylePrefs={stylePrefs}
        />
      );
    case "full_avatar":
    case "avatar_with_cta":
    default: {
      const showCap = Boolean(String(text).trim());
      return showCap ? (
        <CaptionLayer text={text} brandHex={brandHex} stylePrefs={stylePrefs} />
      ) : null;
    }
  }
}

/**
 * Main UGC composition — portrait 9:16 (1080×1920), square 1:1 (1080×1080), or 16:9 (1920×1080).
 *
 * Props:
 *   aspect_ratio   — "9:16" | "1:1" | "16:9" (must match FFmpeg pre-compose & render.js dimensions).
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
 *   `split_gallery`: 2×2 grid (TL,TR,BL + avatar BR). PiP and grid entrance run once per
 *   **run** of consecutive gallery scenes; only captions (and still slots) change between them.
 *   Product `ProductOverlay` is after scene layouts, zIndex 100.
 *
 * Visual layers (bottom → top):
 *   1a. `PipGalleryGrid` (gallery scenes only)   zIndex 1
 *   1b. `PippableAvatarVideo` (full or PiP)    zIndex 2
 *   2.  Website URL + end card                 zIndex 30
 *   3.  Per-scene layout + ding                 zIndex 45
 *   4.  `ProductOverlay` “center pop”         zIndex 100
 *   5.  Progress + BGM
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
  aspect_ratio = "9:16",
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

  const stylePrefs =
    ugc_script?.style && typeof ugc_script.style === "object"
      ? ugc_script.style
      : {};

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

  const pipWeight = getPipWeight(
    frame,
    fps,
    speechFrames,
    sceneStarts,
    sceneDurations,
    scenes,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Layer 1a — full-frame image grid during split_gallery (under PiP video) */}
      <AbsoluteFill style={{ zIndex: 1, pointerEvents: "none" }}>
        {scenes.map((scene, i) => {
          if (resolveSceneLayoutName(scene) !== "split_gallery") {
            return null;
          }
          const startFrame = sceneStarts[i] ?? 0;
          const sceneDuration = Math.max(
            1,
            sceneDurations[i] ?? Math.floor(speechFrames / numScenes),
          );
          return (
            <Sequence
              key={`pip-gallery-grid-${i}`}
              from={startFrame}
              durationInFrames={sceneDuration}
            >
              <PipGalleryGrid
                layoutData={scene?.layout_data}
                brandHex={brandHex}
                continueGalleryRun={isConsecutiveSplitGalleryScene(scenes, i)}
                sceneDurationInFrames={sceneDuration}
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {/* Layer 1b — single OffthreadVideo; PiP spring when layout is split_gallery */}
      <PippableAvatarVideo
        rawVideoUrl={raw_video_url}
        videoPanX={panX}
        videoPanY={panY}
        videoScale={videoScale}
        pipWeight={pipWeight}
        speechFrames={speechFrames}
      />

      {/* Website URL + end-card logo / product */}
      {websiteText || logo_url || productImg ? (
        <WebsiteUrlOverlay
          text={websiteText}
          logo_url={logo_url}
          product_image_url={productImg}
          brandHex={brandHex}
          durationInFrames={durationInFrames}
          aspect_ratio={aspect_ratio}
        />
      ) : null}

      {/* Layer 5 — per-scene ding + layout (split gallery / bullets / full caption) */}
      <AbsoluteFill style={{ zIndex: 45, pointerEvents: "none" }}>
        {scenes.map((scene, i) => {
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
            <Sequence
              key={`ugc-layout-${i}`}
              from={startFrame}
              durationInFrames={sceneDuration}
            >
              {shouldPlayDing ? (
                <Audio src={staticFile("ding.mp3")} volume={0.4} />
              ) : null}
              <SceneLayoutContent
                scene={scene}
                brandHex={brandHex}
                stylePrefs={stylePrefs}
                continuesConsecutiveSplitGallery={isConsecutiveSplitGalleryScene(
                  scenes,
                  i,
                )}
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {/* Layer 4a / above captions — product pop (after layout so it stacks; zIndex 100) */}
      {productImg && productPopDuration > 0 ? (
        <ProductOverlay
          src={productImg}
          startTime={productPopStart}
          duration={productPopDuration}
          brandHex={brandHex}
        />
      ) : null}

      {/* Progress bar — thick track + inset fill so it reads on export & web preview */}
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
    style: {
      animation: "pop",
      position: "bottom",
      font: "heebo",
    },
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
  aspect_ratio: "9:16",
};
