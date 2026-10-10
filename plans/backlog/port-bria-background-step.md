---
title: Port the Bria video-erase panel 3 approach into apps/pipeline
status: Backlog
created: 2026-10-09
updated: 2026-10-09
---

# Port the Bria video-erase panel 3 approach into `apps/pipeline`

## Goal

Make the panel 3 approach used for `.jobs/full-video` (Bria video-erase,
overlapping 5s chunks, crossfades) a real pipeline step, so the next job
doesn't need one-off scripts.

## Context

See [phase 4e](../done/phase-4e-full-video-source-prep.md)'s "Panel 3:
Bria full-song run". The one-off scripts are in
`.jobs/spikes/full-video-panel3/` (`bria-plan.ts`, `bria-run.ts`,
`bria-blend.ts`), with paths from before the job layout cleanup.

- `bria/video-erase-object`: $0.05 per output second, max 5s per clip, max
  750p. It only reads **public URLs**: Replicate Files API URLs need auth,
  so the spike used a temporary public R2 bucket.
- Chunks of 120 frames, evenly spaced within each segment with ≥24 frames
  of overlap, never crossing a hard cut; linear crossfade across the whole
  overlap; upscaled 720 → 1024.
- A temporal mask (union of the alpha ±2 frames, dilated ~24px at 720)
  fixed ghost arms on fast motion, and is probably a better default than
  the raw alpha.
- Bria passes through whatever it's given: a stray panel 2 frame became a
  panel 3 glitch. Worth a stray-frame check on panel 2 before running.

## Approach (rough)

- A `background-video` step in `apps/pipeline`, writing
  `3-background/frames`, with chunk outputs kept for re-blending.
- Upload inputs to R2, run, then delete them, so nothing stays public.
  Needs R2 credentials in `apps/pipeline/.env`.
- Hard cuts as a `job.json` setting.
- Skip-if-output-exists per chunk, no automatic retries (CLAUDE.md).

## Tasks

- [ ] Scope and move to `ready/`

## Open questions

- R2 via the S3 API or `wrangler`?
- Store hard cuts in `job.json`, or detect them?
