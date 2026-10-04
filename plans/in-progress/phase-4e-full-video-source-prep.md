---
title: "Phase 4e: full-song pipeline run (.jobs/full-video)"
status: In Progress
created: 2026-09-30
updated: 2026-10-04
---

# Phase 4e: full-song pipeline run (`.jobs/full-video`)

## Handoff note (read this first)

"Where we're at" is the current state, and "Next steps" is what to do
next. Everything below those is history and findings that explain why
things are the way they are. None of it needs redoing.

## Goal

Run the **whole song** (214.8s, not the 165s `main.mov` this doc
originally targeted, see Findings) through `apps/pipeline` into
`.jobs/full-video`. Reuse the legacy pipeline's existing full-song
per-frame output wherever it's good enough instead of paying Replicate to
regenerate it.

## Where we're at (2026-10-04)

| Panel | State | Cost |
| --- | --- | --- |
| 1 words | `compose` copies the shared `words.mov` as for every job | $0 |
| 2 portrait (`2-portrait/raw`, `upscaled`) | Reused from legacy (`images`, `resized`), 5,156 frames | $0 |
| 3 background | **Keyframe fill run in progress** (`3-background/plate`), then `background-stabilize` | ~1,290 flux-fill-pro calls + pilots |
| 4 matte (`alpha`) | Reused from legacy, original 2160px PNGs, **no glitch repair** (see below) | $0 |
| 5 depth | Reused from legacy, post-masked with alpha | $0 |
| 6 outline | Reused from legacy (`sketch`) | $0 |
| 7 dream | Not started. Needs an art-direction pick first | — |

- Job: `.jobs/full-video` (shared across worktrees via the `.jobs`
  symlink), initialised from
  `/Volumes/HDD/lysterfield-lake-pipeline/video-final/output/main-compiled-full.mov`
  at 24fps, giving **5,156 frames**.
- Legacy population is done by the one-off `.jobs/full-video/populate-legacy.ts`
  using `.jobs/full-video/legacy-frame-map.json` (new 0-based index ->
  legacy 0-based index). Both are generated-job files, not committed.
- **Panel 3 run:** started 2026-10-04, 1,290 keyframes total (every 4th
  frame, `stepFps` 6). It was at ~100/1,290 when this was written; check
  `ls .jobs/full-video/3-background/plate | wc -l`. The step stops on the
  first Replicate-side failure (no automatic retries); rerun the same
  command once and it skips finished frames:

  ```
  bun run --cwd apps/pipeline cli background-plate --job .jobs/full-video
  ```

- **Replicate spend so far on this job:** 126 flux-fill-pro calls across
  the two pilots (including 4 regenerations: 1 Replicate-side failure in v1,
  2 leak-check regenerations in v2, 1 boundary keyframe redone), plus the
  in-progress full run.
- `flux-fill-pro`'s per-call price is still **unconfirmed**. The user is
  checking the Replicate dashboard. It's believed to be ~$0.05/image, so
  the full panel 3 run would be roughly $65.

## Next steps

1. Let the panel 3 keyframe run finish (re-run once on a Replicate-side
   failure).
2. **Visual review of every keyframe fill** on contact sheets (48 per
   sheet, ~27 sheets), as the user asked. The automatic check only catches
   person leaks, so review for defined objects (roads, buildings, poles,
   water), text/signatures and anything off-palette. To regenerate a bad
   fill, move it to `3-background/plate-rejected/<frame>.<n>.jpg` and rerun
   `background-plate`. The seed bumps by the number of prior rejections, so
   the redo is a genuinely different fill.
3. Run `background-stabilize --job .jobs/full-video` (free, local) and
   watch the result in motion, especially fast-motion stretches like
   2011-2040 and the hard cut at ~157s (new frame ~3768).
4. Pick a dream (panel 7) direction before running it at this scale. See
   `plans/backlog/frame-preview-approval-tool.md` and don't repeat
   `real-15s-60fps`'s two failed full-cost takes. Dream needs explicit
   cost sign-off (~1,290 calls at $0.03 ≈ $39).
5. `compose` + publish.

## Panel 3 pipeline changes (2026-10-04)

Motivated by the full-video pilots. All in `apps/pipeline/src`:

- **Keyframe-only fills.** `background-plate` now fills only the
  `stepFps` keyframes (shared `keyframeIndices()` in `job.ts`, so plate and
  stabilize can't drift apart). `background-stabilize` takes panel 2
  (`2-portrait/upscaled`, CLI `--base`) as the base layer outside the mask,
  instead of each frame's own fill. Measured flux-fill-pro drift from its
  input outside the mask: 1.4/255 mean, so this is visually equivalent at
  ~1/4 the calls. (An earlier note here said a keyframe-only plate would
  be "identical"; it isn't byte-identical, because stabilize used every
  frame's fill as the base layer, but it's equivalent in practice.)
- **Bigger mask, covering the whole hold.** The user flagged stylized arms
  showing through panel 3 on fast moves (pilot frames 2023-2028).
  DiffusionCLIP's painterly arms smear past the true silhouette, and the
  mci-interpolated mask lags fast motion mid-hold. Fixes:
  - `reshapeMask` unions several alphas at a fixed 1024px working size and
    applies 96px dilation then blur sigma 24. The old values (100
    ffmpeg dilation passes, sigma 30, at the alpha's native 2160px) worked
    out to ~47px/sigma 14. The dilation is a hand-rolled separable max
    filter, because sharp 0.35's `dilate`/`erode` didn't behave as a plain
    max filter on these masks (the silhouette's top edge moved the wrong
    way, inconsistently).
  - `background-plate`'s mask for each keyframe is the union over its
    hold window plus the next keyframe.
  - `background-stabilize` floors each frame's interpolated mask at that
    frame's own reshaped alpha.
- **Tighter `FILL_PROMPT`.** Pilot v1 invented a paved road with lane
  markings, a red barn, a wind turbine, a power pole, a water channel and
  one signature-like scribble. The prompt now leads with "only open
  grassland, sky and the existing wooden boardwalk" and names exclusions.
- **Per-fill leak check with one capped regeneration.** Each fill is
  scored with the existing local `scoreLeak` as it lands. On failure the
  original goes to `3-background/plate-rejected/` and the frame is
  regenerated **once** with seed + 1. A second failure is kept and logged
  for stabilize's own leak repair. This was explicitly requested by the
  user and is bounded at one extra call per frame, a deliberate exception
  to the CLAUDE.md no-retry rule. Known weakness: boardwalk planks and
  orange flowers read as skin, so both pilot-v2 rejections were false
  positives. At that rate expect ~40 wasted calls over the full song.
- **Result (pilot v2, 62 calls on frames 2001-2240):** no arm leaks, no
  invented objects, a consistent boardwalk through grassland. When the
  arms go wide the mask covers most of the frame and the fill becomes
  soft haze; one frame (2025) shows a faint horizontal haze edge. Clips:
  `.jobs/full-video/pilot/panel3-pilot.mp4` (v1) and `panel3-pilot-v2.mp4`
  (v2), panel 2 left and panel 3 right.

## Other fixes (2026-10-04)

- **`init.ts` crop.** It capped the *crop* at 1280px, so any source larger
  than 1280 got a zoomed-in center crop instead of a full-frame downscale.
  It now crops the full centered square, then scales to 1280.
- **`repairGlitchedFrames` is not safe at full length.** On the full song it
  flagged 80 frames. The cluster checked (2011-2040) was all fast real arm
  motion with correct masks, and "repairing" it would have frozen the arms.
  All 80 were restored to the legacy originals and their depth regenerated.
  The detector needs tuning (or a flagged-frame review list) before it's
  trusted on long footage. There may still be real glitches among those 80;
  nobody has reviewed them individually.

## Findings (2026-09-30 / 10-02, legacy drive)

The legacy run at
`/Volumes/HDD/lysterfield-lake-pipeline/video-final/output/main/output/`
holds a **complete per-frame set for the whole song**: `alpha` (2160px),
`resized` (portrait, upscaled, 1024px; `images` is the 512px raw),
`depth` (RGBA), `sketch` (outline), `words`, `background`/
`resized-background`, `green`, at 12,887 frames each, 1-indexed `%04d.png`.

- **The real full-length source is not `main.mov`.** The legacy frames run
  at 60fps for 214.78s, matching `resources/audio/lysterfield-lake.wav`
  (214.82s). `main.mov` (165s) is a partial edit. Frame-matching 32px
  signatures against `main-cropped.mov`:
  - legacy 0-429 (0-7.15s): **different intro**. It opens on an empty-field
    pan before the subject walks in, where `main.mov` opens on a close-up.
    They converge at 7.17s.
  - legacy 430-9417 (7.17-156.95s): same footage as `main.mov`,
    time-aligned (a `-r 60` resample of the 59.94fps source).
  - **Hard cut at legacy frame 9418 (156.97s)**, confirmed by the user.
    9418-12886 (~57.8s) is a second clip not in `main.mov`.
- `output/main-compiled-full.mov` (2160px, 60fps, 12,887 frames, built
  from the legacy source frames) is therefore the full-song source, aligned
  with every legacy panel.
- **Frame map (measured, not formula).** New 24fps frame k (0-based) lands
  on legacy frame ≈ 2.5k − 3.5 (−3 or −4 vs `round(2.5k)`). That's
  ffmpeg's `-r 24` frame selection, about 58ms behind naive rounding. The
  match error is under 0.6, against ~8 between different encodes, and the
  map is monotonic.
- Spot-checked legacy alpha/portrait/depth/outline/words at legacy frames
  4000 (pre-cut) and 11000 (post-cut): all production-quality.
- Legacy depth already carries its own gamma, so only the alpha post-mask
  from `depth.ts`'s `gammaRescaleAndMask()` was applied (gamma twice would
  double it).
- Panel 3 is deliberately **not** reused: the user wants the new
  soft-stepped mcimask style (reference
  `~/Desktop/panel3-soft-stepped-mcimask.mp4`).

## Earlier session (2026-09-30), on `real-15s-60fps`

1. **Matte (panel 4) glitch repair** added to `matte.ts`
   (`repairGlitchedFrames()`). 9 frames were repaired on the 15s job. See
   the full-length caveat above.
2. **Depth (panel 5) corner artifacts**: `depth.ts` re-applies the alpha
   mask after gamma/rescale. `depth-anything-v2` was tested and rejected
   (it ignores alpha).
3. **Outline (panel 6)** regenerated for the same 9 frames.
4. **`dream.ts`** always appends `NO_PEOPLE_SUFFIX` (also in CLAUDE.md).
5. `real-15s-60fps`'s panel 3 can't be cheaply patched, because its
   `3-background/plate` is gone. Fixing it needs a background-plate re-run.
   Now ~91 keyframe calls with the keyframe-only change. Not done.
6. Filed `plans/backlog/frame-preview-approval-tool.md`.

## Tasks

- [x] Confirm drive access
- [x] Investigate legacy frame reuse (feasible for every panel except 3 and 7)
- [x] Decide scope: the whole 214.8s song from `main-compiled-full.mov`
- [x] `init` `.jobs/full-video` and populate panels 2/4/5/6 from legacy
- [x] Keyframe-only background-plate, bigger windowed mask, tighter prompt,
      per-fill leak check (pilot v1 + v2 reviewed by the user)
- [ ] Panel 3 keyframe run (in progress)
- [ ] Visual review of all panel 3 keyframe fills, regenerate bad ones
- [ ] `background-stabilize` the full song, review in motion
- [ ] Confirm `flux-fill-pro`'s real per-call rate from the dashboard
- [ ] Tune `repairGlitchedFrames` for long footage (or review its 80 flags)
- [ ] Pick a dream direction, then get cost sign-off for panel 7
- [ ] `compose` + publish
- [ ] Decide whether to fix `real-15s-60fps`'s own panel 3 (~91 calls now)

## Open questions

- Should the leak check's false-positive rate (planks/flowers as skin) be
  fixed before the next long run, or is ~3% wasted calls acceptable?
- Is the soft haze on arms-wide frames acceptable, or should the mask
  dilation scale with motion instead of being fixed?
- `real-15s-60fps`'s offset within the song is still unresolved. Only
  needed if anything from that job gets reused, which currently nothing is.
