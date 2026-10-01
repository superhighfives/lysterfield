---
title: "Phase 4e: prep the full 165s source for a full-video pipeline run"
status: In Progress
created: 2026-09-30
updated: 2026-09-30
---

# Phase 4e: prep the full 165s source for a full-video pipeline run

## Handoff note (read this first)

This doc exists specifically so a fresh agent can pick up with no prior
context after the user restarts their terminal app (needed for a macOS
permission grant — see "Current blocker" below). Everything under
"Done this session" already happened and doesn't need redoing. The very
next action is under "Next step" — start there.

## Goal

Process the entire shared raw source clip (`main.mov`, 165s) through the
full `apps/pipeline` chain into a new job at `.jobs/full-video`, reusing
as much already-generated output as possible — both from
`.jobs/real-15s-60fps` (the 15s test job) and, if feasible, from the
**legacy pipeline's own full-video output already sitting on the external
drive** — instead of paying to regenerate everything via Replicate.

## Done this session (2026-09-30), don't redo

1. **Matte (panel 4) artifact fixed.** RVM occasionally glitches for a
   frame or two — confirmed as a uniform shrink of the *entire* silhouette
   outline, not motion (visualized via a neighbor-majority diff on
   `real-15s-60fps` frames 0225-0233 and 0251/0253). Fixed in
   `apps/pipeline/src/steps/matte.ts`: `repairGlitchedFrames()` detects
   frames whose mask disagrees sharply with a temporal-neighbor majority
   vote and repairs them by holding the nearest clean neighbor (same
   pattern as `background-stabilize.ts`'s existing leak repair). Applied
   to `real-15s-60fps`: 9 frames repaired in place.
2. **Depth (panel 5) artifact fixed.** ZoeDepth sometimes hallucinates
   structure in the masked-out corners. Tested swapping to
   `depth-anything-v2` first — rejected, it ignores alpha entirely and
   paints a depth gradient across the *whole* frame, every frame, which is
   worse. Instead, `depth.ts` now re-applies the alpha mask as a hard
   cutout *after* gamma/rescale (`gammaRescaleAndMask()`), independent of
   which depth model is used. Applied to `real-15s-60fps`: the 9
   alpha-repaired frames were regenerated live (real ZoeDepth calls
   against the corrected alpha), and the other 352 existing depth frames
   were fixed locally with zero extra Replicate cost (the post-mask
   commutes with the existing gamma LUT, so no re-call was needed). Both
   known bad frames (0250, 0300) confirmed clean after the fix.
3. **Outline (panel 6)** regenerated for the same 9 frames (depends on
   alpha + depth, both of which changed for those indices).
4. **`dream.ts` hardened**: a fixed `NO_PEOPLE_SUFFIX` is now always
   appended to every take's prompt — `real-15s-60fps`'s two dream takes
   (`dream-styletransfer-v2`, `dream-styletransfer-v2-fixed`) both showed
   a recognisable person, which the per-take prompt alone didn't
   prevent. Also documented in `CLAUDE.md`.
5. **Discovered panel 3 (background) can't be cheaply patched.**
   `real-15s-60fps`'s intermediate per-frame fill (`3-background/plate`)
   no longer exists on disk at all — only the final `3-background/stable`
   output does. Fixing it (for the 9 repaired-alpha frames, or at all)
   needs a full 361-frame `background-plate` re-run (real `flux-fill-pro`
   cost), not a surgical patch. **Not done — left for a future decision.**
6. Filed `plans/backlog/frame-preview-approval-tool.md` — a cheap
   5-frame-at-a-time preview/approval idea for dream art direction, so a
   future full-length dream run doesn't repeat `real-15s-60fps`'s two
   failed full-cost attempts.

## Current blocker

**The external drive (`/Volumes/HDD`) is mounted but not readable from
this session** — `ls`/`stat` on `/Volumes/HDD/lysterfield-lake-pipeline`
returns `Permission denied (code 13)` even with the Bash tool's sandbox
disabled, and the directory shows `drwx------` ownership. This is a macOS
Files-and-Folders / Full Disk Access privacy permission, not something
fixable from inside a session. **The user is restarting their terminal
app so a just-granted permission takes effect** — that's the trigger for
writing this handoff doc. Once restarted, access should work; if it
still doesn't, the permission may have been granted to the wrong app (the
one actually hosting the Claude Code session, not e.g. a different
terminal), or needs re-granting post-restart.

## Next step (do this first after restart)

Re-check access:

```
ls -la "/Volumes/HDD/lysterfield-lake-pipeline/"
```

If that works, immediately look for the legacy pipeline's full-video
**per-frame output** (not just the raw source) — per
`plans/backlog/rebuild-pipeline-as-replicate-cli.md`'s Phase 0 ground-truth
notes, a complete run's output tree lives under
`video-final/output/` on the drive, including `output/alpha/*.png`
(Robust Video Matting — same model the new pipeline uses),
`output/depth/*.png` or similar (ZoeDepth — same model), and watercolor
"artwork"/avatar frames from DiffusionCLIP (same checkpoint/params the
new pipeline's `portrait.ts` uses — see its comment: "Landed back on
DiffusionCLIP itself... same real style"). **The user's idea (this
session, pending investigation): if these are the same models with the
same params, the legacy frames might be directly reusable for
`.jobs/full-video`'s alpha/depth/portrait panels, which would eliminate
most of the per-frame Replicate cost in the table below.**

What to check before trusting that idea:
- **Resolution/crop**: does the legacy output match the new pipeline's
  1280px-capped square crop (`init.ts`), or is it full-res/different
  aspect ratio and in need of re-cropping?
- **Frame rate**: legacy folder names suggest up to 60fps; the new
  pipeline defaults to 24fps (cost-driven, see `init.ts`'s docstring).
  Reusing legacy frames likely means picking every Nth legacy frame to
  match 24fps, not a 1:1 copy.
- **Frame numbering/offset**: legacy frames need to align to whatever
  offset/length the new `full-video` job actually extracts.
- **Visual parity**: `plans/done/phase-5-end-to-end-parity-check.md`
  already found depth panel output is only an approximate match between
  old and new ("same general concept... slightly lower contrast") — not
  byte-identical even with the "same" model, likely due to the new
  pipeline's different pre/post-processing around the raw call. Spot-check
  a few frames before committing to wholesale reuse.

## Other open blockers (independent of the drive)

- **Unknown offset for `real-15s-60fps`** within the 165s source — needed
  to know which of its frames correspond to which part of the full video,
  for reuse. Resolve by frame-matching `real-15s-60fps/source/0001.jpg`
  against the full source once accessible.
- **`flux-fill-pro`'s real per-call rate is still unconfirmed.** Every
  other model's cost below is a confirmed dashboard figure; this one
  isn't (phase-5's cost pass predates the current background-plate
  architecture).

## Rough cost shape (pending the above — likely to shrink a lot if legacy reuse works)

At 24fps, 165s ≈ 3,960 frames (~11x `real-15s-60fps`). Every step runs
per-frame except `dream` (every 4th frame, `stepFps: 6`) and `matte` (one
whole-video call):

| Step | Calls (full video) | $/call | Rough total |
| --- | --- | --- | --- |
| portrait (`diffusionclip`) | ~3,960 | $0.02 (confirmed) | ~$79 — **could drop to ~$0 if legacy artwork frames are reusable** |
| background-plate (`flux-fill-pro`) | ~3,960 | **unconfirmed** | **unknown** |
| depth (`zoedepth`) | ~3,960 | <$0.01 | ~$20-40 — **could drop to ~$0 if legacy depth frames are reusable** |
| outline (custom CPU model) | ~3,960 | <$0.01 | ~$20-40 |
| upscale (`real-esrgan`) | ~3,960 | <$0.01 | ~$20-40 |
| dream (`flux-kontext-dev`) | ~990 | $0.03 (confirmed) | ~$30 |
| matte (`robust_video_matting`) | 1 (whole video) | — | low — **could drop to ~$0 if legacy alpha frames are reusable** |

Without legacy reuse: likely low-to-mid hundreds of dollars total. **Get
explicit cost sign-off from the user before running any per-frame Replicate
step, regardless of how the legacy-reuse investigation turns out.**

## Approach

1. Confirm drive access (see "Next step").
2. Investigate legacy frame reuse for alpha/depth/portrait (resolution,
   fps, offset, visual spot-check — see checklist above).
3. Resolve `real-15s-60fps`'s offset within the full source.
4. `init` a new `.jobs/full-video` job at a chosen fps/crop.
5. Populate as many panels as possible from reuse (legacy drive frames
   and/or `real-15s-60fps`'s overlapping window) before running anything
   live.
6. Get cost sign-off for whatever's left to actually generate.
7. Run remaining steps only for frames not covered by reuse.
8. Pick a dream (panel 7) direction before running panel 7 at this scale
   — see `plans/backlog/frame-preview-approval-tool.md`; don't repeat
   `real-15s-60fps`'s two failed full-cost takes.

## Tasks

- [ ] Confirm drive access post-restart
- [ ] Investigate legacy alpha/depth/portrait frame reuse feasibility
      (resolution, fps, visual spot-check)
- [ ] Resolve `real-15s-60fps`'s source offset
- [ ] Confirm `flux-fill-pro`'s real per-call rate from the dashboard
- [ ] Decide reuse scope (legacy drive frames + `real-15s-60fps` overlap)
- [ ] Get explicit cost sign-off before running any per-frame step
- [ ] Decide whether to also fix `real-15s-60fps`'s own background-plate
      (separate 361-call cost, not required for the full-video job)

## Open questions

- Does "full video" mean the entire 165s, or a specific window within it?
- Once cost is known: full 24fps, or a cheaper fps for a first full-length
  pass (mirroring phase-5's scoped-down-first-pass approach)?
- If legacy frames turn out reusable for alpha/depth/portrait, is it worth
  also checking legacy outline/sketch frames, or is that model different
  enough (packaged ArtLine vs. whatever the legacy local checkpoint was)
  to not bother?
