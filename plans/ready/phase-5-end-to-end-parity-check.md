---
title: "Phase 5: end-to-end run + parity check against an existing published scene"
status: Ready
created: 2026-08-28
updated: 2026-08-28
---

# Phase 5: end-to-end run + parity check against an existing published scene

## Goal

Run one real iPhone source video all the way through `apps/pipeline`'s full
CLI chain — `init` → `matte` → `background-plate` → `artwork` ×2 →
`upscale` ×2 → `depth` → `outline` → `dream` → `compose` — and compare the
result against an already-published `apps/client` scene for parity (visual
+ rough cost/time budget per scene). This is the fifth phase bullet in
[`rebuild-pipeline-as-replicate-cli.md`](../in-progress/rebuild-pipeline-as-replicate-cli.md)
— see that document for full project architecture. Every step has already
been individually smoke-tested (phase 3, 3b) and chain-tested against
synthetic footage (phase 4); this phase is the first real, full-length,
full-cost run of the whole thing, and the first real signal on whether the
new pipeline's output is actually comparable to what the old bash-script
pipeline produced.

## Context

**Target scene: `20230808103741` ("Watercolour").** Its `dreams.json`
prompt is `"A watercolor painting"` — the exact style `artwork.ts` already
targets by construction (its fixed style-reference image, added in the
DiffusionCLIP → `nano-banana-2` swap, *is* a real DiffusionCLIP watercolor
output — see
[`plans/done/phase-3-port-frame-steps.md`](../done/phase-3-port-frame-steps.md)'s
2026-08-28 addendum). Picking this scene means the parity check validates
both phase 4's compose/manifest wiring and the artwork-model swap in one
run, against a style the new pipeline should have its best shot at
matching. `apps/client/public/assets/20230808103741/` already has the
published `hero.jpg` + `loop.mov` to compare against; the full-quality
`video.mov`/`video.webm` aren't committed (gitignored `dreams/`), so
they'd need pulling from wherever they're actually hosted (R2, per
`client-manifest.ts`'s comment) or regenerating isn't meaningful for
parity — the comparison is against the *original* output, not a fresh
regeneration of the old pipeline.

**Blocked on the external drive.** The raw iPhone source footage for any
scene lives only on `/Volumes/HDD/lysterfield-lake-pipeline` (per this
session's repeated checks — nothing under either the `lysterfield` or
`lysterfield-lake-pipeline` repos on this machine has real, unstylized
source video; every local `.mov` is already a published/committed
choose-screen asset). Needs the drive mounted before any of this phase's
tasks can start. Once mounted, locate the scene's original source clip —
likely under a directory keyed by the same `20230808103741` timestamp, per
the old pipeline's apparent id scheme (worth confirming against
`generate-title.sh`/`generate-videos.sh`'s actual path construction, read
during phase 4's research, rather than assumed here).

**What "parity" means here, concretely:**
- **Visual**: the final composite's `artwork`/`background` panels should
  read as recognizably the same watercolor style as the published scene's
  video — not pixel-identical (different model, different frame content
  even if the same source clip), but the same aesthetic family. Also
  worth a visual sanity check that the other five panels (matte, depth,
  outline, dream, words) look sane at full length, not just on the
  4-frame synthetic clip phase 4 tested.
- **Cost/time**: rough total Replicate spend and wall-clock time for one
  full scene, at whatever fps/length the source clip actually is (real
  scenes are likely much longer than phase 4's 4-frame synthetic test, so
  this is the first real signal on whether concurrency settings and
  per-step timing are viable for regular use — see the outline/artwork
  boot-time flakiness both already surfaced mid-pipeline in phases 3b/4).
  No existing baseline number to compare against from the old pipeline
  (nothing in `lysterfield-lake-pipeline`'s scripts logs cost or timing) —
  so this is establishing a first number, not checking against a target.

## Tasks

- [ ] Confirm external drive is mounted; locate scene `20230808103741`'s
      original raw source video
- [ ] Run the full CLI chain against it, backgrounded per step (per this
      session's established pattern — some steps take minutes per frame)
- [ ] `compose` into a scratch client dir first (per phase 4's testing
      pattern), inspect panels before touching the real `apps/client`
- [ ] Visual parity check: compare the new composite's artwork/background
      panels against the published scene's `loop.mov`/hero image
- [ ] Record rough cost (Replicate dashboard spend for this run) and
      wall-clock time per step
- [ ] Decide with the user whether to write the real result into
      `apps/client` (as a new scene, or discard) — this scene id is
      already taken, so a real write would need a different id even if
      the output looks good enough to keep
- [ ] Write up findings (parity verdict, cost/time numbers, any
      model-quality gaps worth tracking) and move this doc to `plans/done/`
- [ ] Tick Phase 5 in the parent plan's task list

## Open questions

- **Which raw clip, if the scene id doesn't map directly to a single file
  on the drive**: resolve once the drive's actually mounted and its
  structure is visible, rather than guessing now.
- **Cost budget / spend authorization**: a full-length real scene through
  nine Replicate model calls (several per-frame, over however many frames
  a real clip extracts to) is real money — confirm rough scope/budget
  with the user before kicking off the full chain, not just before
  `compose`.
