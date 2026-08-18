---
title: "Phase 3b: port outline and dream steps"
status: In Progress
created: 2026-08-18
updated: 2026-08-18
---

# Phase 3b: port outline and dream steps

## Goal

Finish phase 3 by porting the two model-audit-dependent steps that phase 3a
deliberately left out: `outline.ts` (the packaged ArtLine Cog model) and
`dream.ts` (Kling 3.0 Omni). Both decisions were resolved in phase 2; this
phase wires them into `apps/pipeline` the same way phase 3a wired the six
already-on-Replicate steps.

This is the second "Phase 3" bullet in
[`rebuild-pipeline-as-replicate-cli.md`](../in-progress/rebuild-pipeline-as-replicate-cli.md)
— see that document and
[`plans/done/phase-3-port-frame-steps.md`](../done/phase-3-port-frame-steps.md)
for full architecture, the model inventory, and the infra (`replicate.ts`,
`job.ts`, `models.ts`) this phase builds on directly. Don't duplicate that
context here.

## Context

**Outline model isn't live on Replicate yet.** `models/outline/` (phase 2)
is validated locally via `cog predict` (CPU) but never pushed. Pushing
needs: `gpu: true` in `cog.yaml` (local validation ran CPU-only — real
per-frame throughput needs GPU), a `cog login` (separate token from
`REPLICATE_API_TOKEN`, at replicate.com/auth/token — not yet configured in
this environment), and a target model slug under the user's own Replicate
namespace (unconfirmed — the current `REPLICATE_API_TOKEN` resolves to the
`replicate` org account via `/v1/account`, not a personal username, so
don't guess one). **Blocked on the user for both the login and the target
slug — ask before starting this half of the phase.**

**The real preprocessing pipeline for outline isn't just "call the model."**
Per `other.py` (see phase 2's Cog packaging work and the parent plan's
context section): matte-cutout the frame onto a white background using the
alpha mask, resize 1024×1024, blend with the corresponding depth-panel
frame via `soft_light` at 0.5 opacity, enhance brightness ×1.4 (contrast
×1.0, i.e. a no-op — don't bother porting it), resize to 300×300, **then**
call the model. `blend_modes`' `soft_light` has no npm equivalent to reach
for — same situation `depth.ts` was already in with `skimage`, hand-roll it
(standard soft-light blend formula, operate on the same raw-buffer/`sharp`
pattern `depth.ts` established). This step depends on `depth.ts`'s output,
not just `matte.ts`'s — sequence accordingly.

**Dream step needs no legacy port at all.** `generate-dreaming.sh` (frame
extraction + `minterpolate` frame-doubling to fake 60fps from Deforum's
sparse output) is entirely superseded — Kling produces a real smooth video
directly. `dream.ts` is: pick a source frame (default the job's first
`frames/source/` frame, matching `--input`/`--id` from the parent plan's
CLI signature; allow an explicit override), call
`kwaivgi/kling-v3-omni-video` with `start_image` + user-supplied `--prompt`
+ `--style-ref` as a `reference_images` entry, download the output video.
No frame-rate/resize normalization here — that's `compose.ts`'s job in
phase 4, same boundary `upscale.ts` already respects (its 2048×2048 output
isn't resized down either).

**Model parameters already proven in phase 2's prototyping** (scene
`20230808103741`, see the parent plan's Open Questions): `mode: "standard"`,
`aspect_ratio: "16:9"`, `duration: 5` for a quick smoke test — production
duration is an open call for phase 4/5, not this phase. `generate_audio:
false` (client has no audio contract for this panel — lyrics/song audio is
muxed separately in `compose.ts`).

## Approach

### Outline

1. **Ask the user first**: Replicate login (run `cog login` themselves, or
   provide a login token) and the target model slug
   (`r8.im/<username>/<name>`) to push under.
2. Flip `models/outline/cog.yaml` to `gpu: true`.
3. `cog push r8.im/<username>/<name>` from `models/outline/`.
4. Add the pinned `owner/name:version` to `apps/pipeline/src/models.ts`
   (`outline: '...'`) — same pattern as every other model, pinning is
   confirmed required project-wide (phase 3a finding), not just for the
   five Replicate-hosted models.
5. `src/steps/outline.ts`: per-frame, depends on `matte.ts` and `depth.ts`
   output frames (not just source frames) — composite matte-cutout on
   white, blend with matching depth frame (`soft_light`, opacity 0.5),
   brightness ×1.4, resize 300×300, call the model, resize result to
   1024×1024. Add an `outline` case to `cli.ts` taking `--source`,
   `--depth`, and the usual `--job`/`--output`/`--concurrency`.
6. Smoke-test against a few real frames (not full-clip) before considering
   this step done — check the blend actually reads like the reference
   examples in `models/outline/test.jpg`/`reference-res.jpg`, not just that
   the call succeeds.

### Dream

1. `src/steps/dream.ts`: takes a job, an explicit or default source-frame
   path, `prompt`, and `styleRef` path. Calls `MODELS.dream` (add to
   `models.ts`) with `start_image` (via `readFileAsInput`), `prompt`,
   `reference_images: [readFileAsInput(styleRef)]`, `duration: 5`,
   `mode: 'standard'`, `aspect_ratio: '16:9'`, `generate_audio: false`.
   Downloads the output `.mp4` into `<job>/video/dream.mp4`.
2. Add a `dream` case to `cli.ts`: `--job`, `--prompt`, `--style-ref`,
   optional `--frame` (defaults to the job's first source frame).
3. Smoke-test against the same scene/prompt/style-ref phase 2 already
   validated (`20230808103741`, its real prompt from the external drive,
   its `colormatch_image` reference) so this is a confirmation of the
   wiring, not a fresh unknown — the visual result is already known-good
   from phase 2.

## Tasks

- [ ] Confirm Replicate login + target model slug with the user
- [ ] Flip `models/outline/cog.yaml` to `gpu: true` and `cog push`
- [ ] Pin the outline model version in `models.ts`
- [ ] `outline.ts` — matte-cutout + depth soft-light blend + brightness
      preprocessing, model call, resize postprocessing
- [ ] Add `outline` case to `cli.ts`
- [ ] Smoke-test `outline.ts` against real frames
- [ ] Add `MODELS.dream` (`kwaivgi/kling-v3-omni-video`, pinned)
- [ ] `dream.ts` — source frame + prompt + style-ref → Kling call → download
- [ ] Add `dream` case to `cli.ts`
- [ ] Smoke-test `dream.ts` against the phase-2-validated scene/prompt
- [ ] Tick the second "Phase 3" box in the parent plan's task list

## Open questions

- **Replicate push target**: needs the user's Replicate username (or
  confirmation to use the org account this token already resolves to,
  which would make the model non-private) and a `cog login`. Blocking for
  the outline half only — dream doesn't need this, Kling is already public.
