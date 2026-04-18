# UGC provider A/B evaluation (D-ID vs HeyGen)

Use this checklist to compare **lip-sync quality**, **latency**, and **cost** for Hebrew (or any target language) using the same script and similar duration.

## Prerequisites

- `D_ID_API_KEY`, `ELEVENLABS_API_KEY`, and (for HeyGen) `HEYGEN_API_KEY` set on the worker.
- Same **custom script** text for both runs (recommended: 2–4 sentences, Hebrew).
- Same **site URL** (or same crawl context if you omit custom script).

## Procedure

1. In the studio sidebar, open **וידאו אווטאר UGC**.
2. Set **ספק וידאו** to **D-ID**, keep the default portrait URL (or your image URL), optional **voice_id** empty or fixed for both runs.
3. Submit, poll until `ugc_status=completed`, note **wall-clock time** from submit to playable URL.
4. Repeat with **HeyGen + ElevenLabs**; set **אווטאר / תמונת מקור** to a valid HeyGen avatar ID from your account.
5. Watch both outputs (same device/volume). Score subjectively:

| Criterion        | D-ID (1–5) | HeyGen (1–5) | Notes |
|-----------------|------------|--------------|-------|
| Lip-sync (HE)   |            |              |       |
| Natural pacing  |            |              |       |
| Visual quality  |            |              |       |
| Watermark / branding |     |              |       |

6. Record **approximate API latency** (worker logs or stopwatch) and any **quota / credit** impact from each provider’s dashboard.

## Results log (fill in)

| Date | Script length | Provider | Latency (min) | Lip-sync notes | Chosen for prod? |
|------|---------------|----------|---------------|----------------|------------------|
|      |               |          |               |                |                  |

## API reference

- Request model: `GenerateUGCRequest` in `schemas.py` (`provider`, `avatar_id`, `voice_id`, `custom_script`, …).
- Dispatch: `dispatch_ugc_generation` in `services/ugc_service.py`.
