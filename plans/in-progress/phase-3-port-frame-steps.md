---
title: "Phase 3: scaffold apps/pipeline and port init/matte/background-plate/depth/artwork/background/upscale"
status: In Progress
created: 2026-08-18
updated: 2026-08-18
---

# Phase 3: scaffold apps/pipeline and port init/matte/background-plate/depth/artwork/background/upscale

## Goal

Stand up `apps/pipeline` as a real Bun/TypeScript workspace package and port
every already-decided, already-on-Replicate pipeline step from the old bash/
Python scripts. This is the first "Phase 3" bullet in the parent plan —
`outline`/`dream` (the model-audit-dependent steps) are deliberately excluded
and get their own follow-up spec once this lands, since they depend on the
Cog model push and Kling integration being wired up separately.

This is phase 3 of
[`rebuild-pipeline-as-replicate-cli.md`](../in-progress/rebuild-pipeline-as-replicate-cli.md)
— see that document for full architecture and the model inventory table.
This spec only covers phase 3's own scope and the exact technical parameters
extracted from the legacy scripts.

## Context

**Source of truth for exact parameters**: `generate-init.sh`,
`generate-init-alpha.sh`, `main.py`, `background.py`, `other.py`,
`generate-watercolour.sh`, `generate-background.sh`, `generate-other.sh` in
`lysterfield-lake-pipeline` (tracked repo, byte-identical to the external
drive copy per phase 0's diff). `main.py` and `background.py` are
byte-identical files — the only difference between the "artwork" and
"background" steps is which frame folder they're pointed at, driven by the
orchestrating shell script's `-i`/`--input` flag, not anything in the Python
itself. Port that as one shared step function parameterized by input frames,
not two near-duplicate files.

**Live Replicate schemas have already drifted from what the scripts show** —
confirmed by fetching each model's current `openapi_schema` directly rather
than trusting the old HTTP call shapes:

- `cjwbw/real-esrgan` dropped the old `version: "General - RealESRGANplus"`
  enum param entirely. Its current input is just `image` + `upscale` (int,
  default `4`). The old scripts also used a different key name (`img`, not
  `image`) — an artifact of the old local Cog server, not something to
  carry forward.
- `gwang-kim/diffusionclip` gained two params the old scripts never set:
  `manipulation` (default `"ImageNet style transfer"`) and
  `degree_of_change` (default `1`). Its defaults already match what the old
  script hardcoded (`edit_type: "ImageNet style transfer - Watercolor art"`,
  `n_test_step: 12`) — confirmed `"ImageNet style transfer - Watercolor
  art"` is still a valid enum value today, so this one param hasn't drifted,
  just gained neighbors. Use the defaults for the two new params.
- `cjwbw/zoedepth` takes `image` + `model_type` (enum `ZoeD_N`/`ZoeD_K`/
  `ZoeD_NK`, default `ZoeD_N`) — matches the old script, which never set
  `model_type` either (relied on the same default).
- `arielreplicate/robust_video_matting` takes `input_video` (a whole video,
  not per-frame!) + `output_type` (enum `green-screen`/`alpha-mask`/
  `foreground-mask`, default `green-screen` — **must be set to
  `alpha-mask`**, the default is wrong for this pipeline).

Current `latest_version` ids (informational — pin at implementation time,
don't hardcode into this spec as they can move): `gwang-kim/diffusionclip`
`a64682eb…`, `cjwbw/zoedepth` `6375723d…`, `cjwbw/real-esrgan` `d0ee3d70…`,
`arielreplicate/robust_video_matting` `73d2128a…`, `jd7h/propainter`
`e5ea7ae0…`.

**Version pinning turned out not to be optional.** Discovered while
smoke-testing `matte.ts`: the `"owner/name"` latest-version shorthand (both
`replicate.run()` without a version and the `/v1/models/{owner}/{name}/
predictions` REST endpoint it calls) 404s for every single model this
pipeline uses — confirmed against all five. Only the explicit
`"owner/name:version"` form (or `/v1/predictions` with a `version` field)
works. Not something the parent plan's design anticipated — `replicate.ts`
and every step must always call through a pinned identifier; see
`src/models.ts` for the single source of truth.

**`background-plate` has no direct legacy equivalent to port** — the old
approach (`pc-settings/script.sh` + `video-inpaint-anything/
remove_anything_video.py`) ran SAM (`vit_h`) + LaMa (`big-lama`) + STTN by
hand on a PC, splitting the video into 5-second segments, clicking a fixed
point (`--point-coords 256 256`) to select the subject, `--dilate-kernel-
size 30`, at 60fps, then concatenating segments back together. Per the
parent plan, the new version should be driven by the alpha matte instead of
a manual click. Searched Replicate for a fit: **`jd7h/propainter`**
(`video` + `mask` — accepts a static image or video mask, `mode:
video_inpainting`, `save_fps`) is a proper temporally-consistent video
object-removal model, a strictly better match than re-running frame-by-frame
LaMa (`allenhooo/lama`, image-only, would flicker frame to frame with no
temporal consistency). Use ProPainter with the matte step's alpha-mask
video as `mask` directly — no manual segmentation needed at all.

**Depth step has real postprocessing to replicate**, not just a model call.
Before calling ZoeDepth, `other.py` composites the frame onto a **transparent**
background using the alpha matte (`Image.new(mode="RGBA", color=(0,0,0,0))`,
paste with the alpha as mask, resize to 1024×1024, convert to RGB before
sending — matting the subject out, not in, is intentional: it's masking
everything except the depth-relevant subject). After the model call, it
gamma-corrects (`skimage.exposure.adjust_gamma(result, 1.0/2.2)`) then
rescales intensity to a narrow high band (`skimage.exposure.rescale_intensity(
result, (235, 255))`) — this specific narrow rescale is why the depth panel
reads as it does in the final composite; get this math right, there's no
`skimage` equivalent to reach for in TS, hand-roll both steps.

**Upscale runs twice per frame**, once each on the artwork output and the
background-artwork output (`other.py`'s `resized` and `resized-background`
sub-blocks) — same model, same params, two different input folders. Port as
one step function called twice, not two step files.

**Frame/directory conventions to preserve**: 4-digit zero-padded PNG frame
numbers (`%04d.png`) throughout, matching the legacy scripts exactly —
`job.ts`'s working-directory layout should keep this convention so a human
comparing output trees against the old pipeline's `output/` folder can
still make sense of it. Idempotency in the old scripts is a same-shaped
check everywhere: skip a frame if its output path already exists
(`if not os.path.exists(...)` in Python, `[ ! -f ... ]` in bash) — `job.ts`
centralizes this instead of repeating it in every step.

**`init` needs no model** — pure `ffmpeg`/`ffprobe`. From
`generate-init.sh`: crop to a square capped at 2160px
(`crop=w='min(min(iw\,ih)\,2160)':h='min(min(iw\,ih)\,2160)',scale=2160:2160,
setsar=1`), extract frames at a configurable fps (default 60,
`-r $frames`), then compile two reference videos — a 1024-wide "original"
(`scale=1024:-1`) and a full-res "full" (no scale) — both `libx264`/
`yuv420p`. `generate-init-alpha.sh` does the mirror operation once alpha
frames exist (compiles `output/alpha/%04d.png` into a 1024-wide video) — a
useful example of the "compile a frame folder into a reference video" shape
that recurs after every per-frame step, not just alpha.

## Approach

### Package scaffold

`apps/pipeline/` as a Bun workspace package (matches the root's `bun.lock`/
`bunfig.toml` from phase 1): `package.json`, `tsconfig.json` (mirror
`apps/client`'s strict-mode settings — ESM, bundler resolution — swap
`jsx`/DOM lib for a Node-only lib set), `.env.example` documenting
`REPLICATE_API_TOKEN`, `src/` per the parent plan's layout:

```
apps/pipeline/
├── src/
│   ├── steps/
│   │   ├── init.ts
│   │   ├── matte.ts
│   │   ├── background-plate.ts
│   │   ├── artwork.ts          # shared by "artwork" and "background" — see below
│   │   ├── depth.ts
│   │   └── upscale.ts
│   ├── replicate.ts
│   ├── job.ts
│   └── cli.ts                  # minimal — enough to run one step in isolation
└── package.json
```

`artwork.ts` exports one function taking an explicit input-frames directory,
called once for the raw frames and once for the background-plate frames —
don't create a separate `background.ts` that duplicates it, matching the
legacy `main.py`/`background.py` finding above.

### `replicate.ts`

Thin client: read `REPLICATE_API_TOKEN` from `.env`, create a prediction,
poll until terminal state. Real behavioural difference from the old
scripts — Replicate's hosted API is async (create → poll), the old scripts
called a local Cog server synchronously and got the result inline. Every
step module goes through this, not raw `fetch` calls.

### `job.ts`

Per-run working directory (mirrors the legacy `output/<scene>/...` tree),
concurrency cap for per-frame steps (artwork/background/depth/upscale — the
ones that fan out to one Replicate call per frame), and the shared
skip-if-exists idempotency check described above. Also owns the "compile a
frame folder into a reference video" ffmpeg helper (the pattern used
repeatedly across `generate-*.sh` after every per-frame step) so step
modules don't each reimplement it.

### Steps

- **`init.ts`**: ffmpeg crop/scale/extract per Context above. No Replicate
  call.
- **`matte.ts`**: one `arielreplicate/robust_video_matting` call against the
  init step's cropped video, `output_type: "alpha-mask"`. Video-level, not
  per-frame — extract the returned alpha video into `%04d.png` frames
  afterward to keep the rest of the pipeline's frame-based contract intact.
- **`background-plate.ts`**: one `jd7h/propainter` call, `video` = the init
  step's cropped video, `mask` = the matte step's alpha-mask video,
  `mode: "video_inpainting"`, `save_fps` matching the init step's fps.
  Output is the "background" plate directly — extract frames the same way
  as matte, feeding `artwork.ts` a second time for the "background artwork"
  panel.
- **`artwork.ts`**: per-frame `gwang-kim/diffusionclip`, `edit_type:
  "ImageNet style transfer - Watercolor art"`, `n_test_step: 12`, defaults
  for `manipulation`/`degree_of_change`. Called against init's raw frames
  (artwork panel) and again against background-plate's frames (background
  panel).
- **`depth.ts`**: per-frame — composite onto transparent background using
  the matte's alpha (not white; see Context), resize 1024×1024, call
  `cjwbw/zoedepth` with defaults, then gamma-correct + narrow-range
  rescale exactly as `other.py` does.
- **`upscale.ts`**: per-frame `cjwbw/real-esrgan`, `upscale: 4` (current
  default — confirm this still matches the old pipeline's visual target
  before locking it in, since the old `version` param is gone and there's
  no longer a direct equivalent to compare against). Called once against
  artwork output, once against background-artwork output.

### Testing shape

Per the parent plan: "each step should be runnable and testable in
isolation against a single frame before wiring into the full CLI." The
minimal `cli.ts` in this phase should support that — invoke one step by
name against a small local input and inspect the output — not a full
`lysterfield generate` end-to-end command yet (that's phase 4, once
`compose.ts` and client-manifest writing exist too).

## Tasks

- [ ] Scaffold `apps/pipeline` (package.json, tsconfig.json, `.env.example`,
      `src/` layout)
- [ ] `replicate.ts` — auth, create + poll predictions
- [ ] `job.ts` — working directory, concurrency cap, skip-if-exists,
      compile-frames-to-video helper
- [ ] `init.ts` — crop/scale/extract, compile original + full reference
      videos
- [ ] `matte.ts` — Robust Video Matting, alpha-mask output, frame extraction
- [ ] `background-plate.ts` — ProPainter driven by the matte's alpha video
- [ ] `artwork.ts` — DiffusionCLIP, shared function for artwork + background
      panels
- [ ] `depth.ts` — transparent-composite preprocessing, ZoeDepth call,
      gamma + rescale-intensity postprocessing
- [ ] `upscale.ts` — Real-ESRGAN, called against both artwork outputs
- [ ] Minimal `cli.ts` to run one step in isolation against a small local
      input
- [ ] Smoke-test each step against a real frame/short clip (e.g. from the
      external drive's `main.mov`) before considering the phase done

## Open questions

- **Real-ESRGAN's `upscale` factor**: the old pipeline used a named
  `version` preset (`General - RealESRGANplus`) that no longer exists on
  the live model; the replacement is a numeric `upscale` factor (default
  `4`). Worth a quick visual check against an old upscaled frame from the
  external drive before locking in `4` — flag during implementation, not
  blocking the start of this phase.
- **Resolved — `background-plate` model**: ProPainter doesn't work at all —
  its Cog wrapper's mask-extension validation fails against every
  Replicate-hosted file URL, reproduced via raw API calls with clean,
  freshly-uploaded URLs (a bug in that model, not our upload). Switched to
  the anticipated fallback, per-frame `allenhooo/lama`. Mechanically
  correct (confirmed: cleanly erases whatever region the mask marks), but
  smoke-testing surfaced a separate, real content-quality issue worth
  tracking into phase 5's parity check rather than solving now: Robust
  Video Matting's alpha output for the test clip (a person standing mostly
  still, gesturing with one arm) only tracked the moving arm, not the full
  body — so `background-plate` only erased the arm, not the person. Worth
  revisiting matte quality (dilate the mask before inpainting, matching the
  legacy SAM step's own `--dilate-kernel-size 30`; or try `model_type`
  variants) once there's a full real scene to test against, not blocking
  the rest of phase 3's step-by-step porting.
