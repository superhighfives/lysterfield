---
title: "Phase 4b: player and choose-screen polish after the React 19 migration"
status: Complete
created: 2026-09-30
updated: 2026-10-04
---

# Phase 4b: player and choose-screen polish after the React 19 migration

## Goal

Close the gap between local dev and the live (not-yet-redeployed) production
site, surfaced by directly comparing screenshots of both this session. The
React 19 + `@react-three/fiber` v9 + `@react-three/drei` v10 migration
(commit `b878890`, 2026-09-20) hasn't been deployed yet — production is
still running whatever was last actually shipped via `bun run deploy`. That
makes this the first real side-by-side check of the migrated client against
what's live, and it surfaced several real regressions/rough edges beyond
what that migration's own follow-up fix commits caught.

## Context

**Confirmed versions** (`apps/client/package.json`): `react`/`react-dom`
`^19.3.0`, `@react-three/fiber` `^9.7.0`, `@react-three/drei` `^10.7.8`,
`three` `^0.170.0` — all from `b878890`. Nothing has been deployed since;
production is pre-migration.

**Already fixed this session, not part of this phase's remaining work**
(listed for cross-reference so they don't get re-investigated):
- Footer icon size/alignment in the playhead bar (commit `6a9ce68`)
- `isMobile` false-positive on desktop Safari, showing the mobile-only
  reorient icon (commit `9b09f4b`)
- Composed `.mov` output stuck at 0:00 — missing `-movflags +faststart`
  (commit `52a1be7`)
- `Choose`/`Slider`'s `useTexture`-during-render React 19 console warning
  (commit `ec35641`)

**Zoom/scale regression — resolved, was a comparison artifact, not a
real regression.** Root-caused by diffing actual runtime numbers between
a worktree at the pre-migration commit (`bece8e8`: fiber 8.13.5/drei
9.79.3/three 0.154) and current `main` (fiber 9.7.0/drei 10.7.8/three
0.170), both instrumented with temporary debug logging:
- `state.viewport.width/height`, the custom camera's `zoom`/`fov`/`posZ`,
  and the canvas buffer/CSS pixel dimensions were all **identical**
  between the two versions at matched window size.
- Screenshots taken at the **same absolute window size** (1280×800) are
  visually pixel-identical between old and new — no 1.4–1.5x discrepancy
  reproduces.
- The original "1.4–1.5x larger" observation was a comparison artifact:
  the two reference screenshots were checked for matching *aspect ratio*
  but not matching *absolute window size*, and this scene has a fixed
  world-space FOV with no DPR/size-based auto-fit — so absolute on-screen
  size of 3D content scales directly with window pixel dimensions, by
  design, in both versions. One browser tab sized 1600×960 next to
  another at 1280×800 (similar aspect ratio, different absolute size)
  reproduces the exact illusion.
- No code change made — `scene.tsx` is unchanged.

**New issues reported (2026-09-30):**
- **Playhead fades out unexpectedly — fixed (commit `99a5c75`, after a
  false start at `6934b3c`).** Root cause: media-chrome's
  `<media-controller>` auto-hides every slotted control (opacity 0)
  after 2s of pointer inactivity during playback — a `userinactive`
  host attribute drives a CSS rule meant for overlay-on-video controls,
  which isn't our use case (a persistent pill below the video). First
  attempt added the `noAutohide` prop to `<MediaController>`, verified
  via computed opacity, and shipped — but that verification was a false
  positive (the video happened to be paused at check-time, and the hide
  rule only applies `:not([mediapaused])`). `noAutohide` is actually a
  CSS-only opt-out matched against each *individual* slotted control's
  own attribute (`::slotted(...):not([noautohide])`) — setting it on
  the controller itself matches nothing. The real fix is
  `autohide="-1"`, the controller's own JS-level switch that stops
  `userinactive` from ever being set in the first place. Re-verified
  properly this time: genuinely playing video (`currentTime` advancing),
  real hover to trigger pointer-active state, then 4s with zero further
  pointer movement — controls stayed visible. Unrelated to the earlier
  `useTexture.preload` choose-screen fix.
- **Weird shadow on the playhead's hover time-preview text — fixed
  (commit `6934b3c`).** Root cause: `media-time-range`'s default CSS
  applies `text-shadow: 0 0 4px rgb(0 0 0 / .75)` to the preview time via
  `--media-preview-time-text-shadow`, intended for contrast over a video
  thumbnail background. Never overridden against our opaque white pill,
  so it rendered as a stray blurred halo. Fixed by setting that custom
  property to `none`.
- **No audio — not a bug, confirmed working as intended.** The `<video>`
  in `playhead.tsx` is deliberately `muted` only when
  `location.hostname` is `localhost`/`127.0.0.1` (dev-safety, pre-dating
  this phase). Confirmed live on a local dev session: `video.muted` was
  `true` with `hostname === "localhost"`, fully explaining silent
  playback there. Confirmed the composed media itself has real audio
  tracks (`ffprobe` on an existing composed dream: `aac` in `.mov`,
  `opus` in `.webm`), and the pipeline's `compress()` step doesn't strip
  audio (no `-an`/explicit `-c:a`, so ffmpeg's default stream selection
  carries it through). On any non-localhost hostname (including
  production) `muted` is `false`. No code change made.
- **Playhead bar height doesn't match the reference design — fixed
  (commit `14f08c8`).** User supplied the reference screenshot. Measured
  it precisely (pixel-analyzed the yellow border/thumb/track against a
  known-matching `max-w-[400px]` width to confirm a 2x DPR capture):
  target pill is exactly 400×34 CSS px, vs. our previous 400×54 — track
  (`h-2`) and thumb (`w-4 h-4`) sizes were already an exact match, so
  only the pill height, icon size (20px→16px), and button/row padding
  needed to shrink. Scoped to the `xs:` (one-row desktop) breakpoint only
  via responsive Tailwind classes — the two-row mobile layout is
  untouched, since no mobile reference exists yet (see open question
  below).
- **General "janky/not smooth" impression — dedicated pass done (commit
  `770ac72`).** Code-reviewed `scene.tsx`, `choose.tsx`, `main.tsx`,
  `playhead.tsx`, `slider.tsx`, `polaroid.tsx` for the same class of
  per-frame-re-render/allocation bugs this codebase already fixed
  elsewhere (see the `globalPointer`/`px`/`timeRef` comments). Found and
  fixed one real instance that was missed: `polaroidVisible` was written
  to the zustand store every frame from `choose.tsx`'s `useFrame` and
  read *reactively* by both `Scene` and `Playhead`, re-rendering each
  60x/sec during any scroll — `Playhead` in particular is a real DOM
  tree (MediaController + every button/tooltip), so this was likely the
  single biggest remaining jank source. Fixed by splitting it: `Scene`
  now reads the continuous value non-reactively via `getState()` inside
  its own `useFrame`; `Playhead` subscribes to a new derived
  `polaroidPillVisible` boolean that's only written when it actually
  crosses the 0.3 threshold. Also fixed a smaller per-frame Vector2
  allocation in `main.tsx` (reused via `.set()` rather than `new
  Vector2()` each frame — but *not* for `globalPointer` itself, which
  `playhead.tsx`'s recalibration watcher depends on getting a fresh
  reference every frame) and hoisted `Polaroid`'s static transform
  arrays out of render. `slider.tsx`'s spring/drag handling and the
  pervasive `config.molasses` easing were reviewed and are deliberate,
  not bugs — `molasses` is slow by design (the "dreamy" feel), so if
  the app still reads as sluggish rather than stuttery after this,
  that's a design choice to revisit, not a performance bug to fix.

## Tasks

- [x] Root-cause the camera zoom/scale regression — confirmed a
      comparison artifact (mismatched window sizes between reference
      screenshots), not a library-level regression. No fix needed.
- [x] ~~Fix the zoom to match production's scale~~ — n/a, nothing was
      actually wrong.
- [x] Reproduce and fix the playhead fade-out — was media-chrome's
      autohide-on-inactivity; fixed via `autohide="-1"` (commit
      `99a5c75`, after a false-start `noAutohide` fix at `6934b3c`
      that didn't actually work — see context above).
- [x] Fix the hover time-preview shadow/halo artifact on
      `MediaTimeRange`'s preview slot (commit `6934b3c`).
- [x] Investigate missing audio — confirmed working as intended
      (localhost-only dev mute, composed output has real audio tracks).
      No fix needed.
- [x] Match the playhead bar's height/proportions exactly to the reference
      design (commit `14f08c8`, desktop/`xs:` only).
- [x] Once the above are fixed, do a dedicated pass on the general
      "janky/not smooth" feeling (commit `770ac72`).
- [x] Fix choose-screen carousel cards overlapping/content bleeding
      through neighbors (reported 2026-09-30, not in original scope).
      Two attempts: a `renderOrder` fix for a transparency-sort theory
      (commit `721c9b2`) that didn't actually resolve it when
      re-checked live, then increased depth (Z) separation between
      adjacent cards per the user's own diagnosis (commit `f245175`),
      verified clean across several auto-scroll passes including both
      stray `dream-v1`/`dream-styletransfer-v2-fixed` placeholder cards
      at their steepest angle. **Superseded:** `f245175` was reverted in
      `a572be1` because it caused a severe zoom regression through drei's
      `<Center>`. The overlap was then fixed for real in phase 4c, which
      draws the cards as per-card depth layers (see
      `plans/done/phase-4c-frontend-polish.md`).
- [ ] Re-verify against the live production reference. This can't be
      done yet: production hasn't been redeployed since the React 19
      migration (`b878890`). It moves to Follow-ups, since it's a
      post-deploy check rather than outstanding work.

## Overview

Phase 4b was the first side-by-side comparison of the React 19 / fiber v9
/ drei v10 client against production (still pre-migration), and it fixed
what that surfaced.

What turned out not to be a bug:

- **The suspected camera zoom regression** was a comparison artifact.
  The reference screenshots matched in aspect ratio but not window size,
  and the scene's on-screen size scales with window size by design.
  Runtime viewport and camera numbers were identical across versions.
- **The missing audio** was the deliberate localhost-only dev mute. The
  composed media does carry audio tracks.

Real fixes:

- the playhead pill fading out mid-playback (media-chrome's autohide)
- a stray text-shadow halo on the time preview
- the pill's height and proportions, matched to the reference design
  (desktop/`xs:` only)
- a jank pass, the biggest item being a per-frame store write that
  re-rendered `Scene` and `Playhead` 60× a second during scroll

The carousel-overlap item was attempted here, but the attempt was
reverted, and phase 4c delivered the real fix.

## Architecture

All changes are in `apps/client`.

- **Playhead autohide** (`playhead.tsx`): `autohide="-1"` on
  `<MediaController>`, its JS-level switch. `noAutohide` on the
  controller matched nothing, because the CSS opt-out is per slotted
  control. That turned out to be incomplete: media-chrome also sets
  `userinactive` when it connects, so the pill was empty until the first
  pointer move. Phase 4c finished it with `noautohide` on the slotted
  control row.
- **Time-preview halo**: `--media-preview-time-text-shadow: none` on the
  pill.
- **Pill size**: 400×34 at `xs:` (from a pixel-measured reference), with
  smaller icons and padding. The two-row mobile layout is unchanged.
- **Jank** (`770ac72`): `polaroidVisible` is read non-reactively via
  `getState()` inside `useFrame`. `Playhead` subscribes only to a derived
  `polaroidPillVisible` boolean, written when it crosses its threshold.
  A per-frame `Vector2` allocation is reused (but not `globalPointer`,
  whose reference identity the recalibration watcher relies on).
  `Polaroid`'s static transform arrays are hoisted out of render.
  `config.molasses` easing is a deliberate "dreamy" choice, not a bug.
- **Carousel overlap**: a `renderOrder` attempt (`721c9b2`) didn't fix
  it, and the Z-separation attempt (`f245175`) was reverted (`a572be1`).
  Phase 4c replaced both with per-card depth layering.

## Follow-ups

- **After the next deploy**, compare the live site against these fixes.
  Nothing current exists to compare against until production is
  redeployed post-React-19.
- **Mobile pill proportions**: still open whether the height and
  proportions fix should also apply to the two-row mobile (below `xs:`)
  layout. It needs a mobile reference design.
