---
title: "Phase 3b: port outline and dream steps"
status: In Progress
created: 2026-08-18
updated: 2026-08-19
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

- [x] Confirm Replicate login + target model slug with the user — user ran
      `cog login` as `superhighfives`
- [x] Flip `models/outline/cog.yaml` to `gpu: true` and `cog push`
- [x] Pin the outline model version in `models.ts`
- [x] `outline.ts` — matte-cutout + depth soft-light blend + brightness
      preprocessing, model call, resize postprocessing
- [x] Add `outline` case to `cli.ts`
- [ ] **Blocked** — Smoke-test `outline.ts` against real frames: the pushed
      model hangs indefinitely in `starting` on Replicate's GPU
      infrastructure, on both T4 and L40S hardware tiers, never reaching
      our own `setup()` logs. See Architecture for what's ruled out.
- [x] Add `MODELS.dream` (`kwaivgi/kling-v3-omni-video`, pinned)
- [x] `dream.ts` — source frame + prompt + style-ref → Kling call → download
- [x] Add `dream` case to `cli.ts`
- [x] Smoke-test `dream.ts` against the phase-2-validated scene/prompt —
      matches phase 2's result (person fully dissolves into a watercolor
      landscape by the end of the clip)
- [ ] Tick the second "Phase 3" box in the parent plan's task list — held
      until `outline.ts` is actually verified against a live endpoint, not
      done here since the phase's own goal isn't fully met yet

## Open questions

- **Outline model boot hang** (2026-08-18/19): needs a fresh look, ideally
  in a session where the boot issue can be reproduced with more visibility
  (Replicate support ticket, or wait and retry — may be transient platform
  capacity). Not spending more time on it this session per the user's call.

## Overview (partial — outline still blocked)

`dream.ts` is fully shipped and verified: one `kwaivgi/kling-v3-omni-video`
call per scene, taking a source frame + prompt + style-reference image,
downloading the resulting video. Confirmed working end to end via the CLI
against the same scene/prompt/style-ref phase 2 already validated.

`outline.ts` is fully written and wired (matte-cutout onto white, soft-light
blend with the matching depth frame, brightness enhancement, then the model
call) and the packaged Cog model from `models/outline/` is pushed live to
`superhighfives/lysterfield-outline` on Replicate — but every prediction
against it hangs indefinitely in `starting`, on two different hardware
tiers, without ever reaching our own `setup()` logs. This isn't left in
`plans/done/` because the phase's stated goal — port outline *and* dream —
isn't actually met; leaving it in-progress here rather than closing it out
prematurely.

## Architecture

Four `cog push` attempts before landing a build that at least *pushes*
cleanly:

1. `gpu: true`, cog 0.21.0, default CUDA base image — pip install fails
   with `externally-managed-environment` (a real, currently-open upstream
   bug: `uv`-managed Python + CUDA base image + PEP 668, see
   `replicate/cog#2994`).
2. Upgraded to cog 0.22.0 (brew's `cog` formula shadowed the pre-existing
   `/opt/homebrew/bin/cog` binary — invoked the Cellar path directly rather
   than fight the user's `PATH`/symlinks) — pip install succeeds, but the
   container fails at `cog`'s own post-push verification step:
   `[FATAL tini] exec python failed: No such file or directory` (the CUDA
   base image only provides `python3`, not `python`).
3. `--use-cuda-base-image=false` to sidestep both — builds and pushes
   cleanly, but Replicate auto-disabled the resulting version:
   `"Version disabled ... consistently fails to complete setup"` — almost
   certainly because a `gpu: true` model needs actual CUDA in the image,
   which this flag removes entirely.
4. Reverted to the default CUDA base image, added an explicit
   `run: ln -sf $(which python3) /usr/bin/python` to `cog.yaml` to fix
   attempt 2's real problem without attempt 3's regression. This build
   pushes cleanly *and* passes cog's own local post-push verification
   (which actually boots the image) — but predictions against it still
   hang in `starting` forever on Replicate's actual GPU workers, confirmed
   on both T4 and L40S hardware tiers.

That last hang is unexplained. What it's *not*: a missing-hardware-tier
issue (checked, both tiers configured), the `externally-managed-environment`
bug (fixed, build 4 gets past pip install), or the missing-`python`-symlink
bug (fixed, and confirmed fixed by `cog push`'s own local boot-and-verify
step succeeding). The gap between "boots fine locally when cog verifies it"
and "never boots on Replicate's GPU fleet" points at something in Replicate's
scheduler/infra rather than the image itself, but that's a hypothesis, not
a confirmed root cause. Whoever picks this back up should start from
`models/outline/cog.yaml`'s current state (attempt 4) — don't re-litigate
attempts 1-3.
