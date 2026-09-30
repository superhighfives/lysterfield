---
title: "Phase 4b: player and choose-screen polish after the React 19 migration"
status: In Progress
created: 2026-09-30
updated: 2026-09-30
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

**Zoom/scale regression — not yet root-caused.** Side-by-side screenshots
at matching aspect ratios (~1.67–1.70) show the choose-screen polaroid
carousel rendering roughly **1.4–1.5x larger** locally than on the live
site — noticeably fewer, bigger cards fit the same viewport. Investigated
so far:
- `scene.tsx`'s camera setup (`fov={50}`, `CAMERA_Z=1.5`,
  `zoom={w >= 1 ? 1 : w}`) is **byte-for-byte unchanged** since before
  `b878890` (confirmed via `git show b878890 -- .../scene.tsx` — only
  mechanical changes: `ThreeEvent` import, ref-init-to-null, the
  `MediaReadyState` → native-constant swap). So this isn't a deliberate
  code change; it's most likely a version-level behavior change in how
  `@react-three/fiber`/`drei`/`three` compute viewport/camera/resize.
- Ruled out **aspect ratio** as the explanation — both reference
  screenshots are close enough (1.669 vs 1.699) that this alone can't
  produce a 1.4–1.5x difference.
- Ruled out (or at least: insufficient alone) the **pointer-driven camera-Z
  parallax** in `scene.tsx`'s `useFrame` (camera moves closer/further based
  on mouse Y position) — tested directly via synthetic `pointermove` events
  in a live dev session; even at an extreme cursor position the formula
  (`CAMERA_Z - pointer.y/4`) only accounts for ~13% distance change, far
  short of the observed ~45% size difference. Real, but not the main cause.
- Not yet tried: actually diffing `@react-three/fiber`/`drei`'s
  viewport/resize computation between the pinned versions and whatever
  production is running (would need the pre-migration lockfile in a
  worktree to compare against directly, rather than reasoning about it from
  changelogs).

**New issues reported (2026-09-30), not yet investigated:**
- **Playhead fades out unexpectedly** — screenshot shows the lyrics/intro
  text with a completely blank white/yellow-bordered pill beneath it (no
  icons, no timestamp, nothing rendered inside). This looks like the same
  shape as the earlier "blank pill" symptom the `useTexture.preload` fix
  (commit `ec35641`) addressed, but that fix was specifically for the
  Choose/Slider texture-loading path — this is a different trigger/moment
  (during the lyrics intro, not the choose screen) and needs its own
  reproduction + diagnosis.
- **Weird shadow on the playhead's hover time-preview text** — screenshot
  shows the scrub bar's hover/preview time (`MediaPreviewTimeDisplay`,
  e.g. "1:09") rendering with an odd blurred gray halo/box behind it,
  floating above the real elapsed-time text ("1:01") and slider.
- **No audio** during playback.
- **Playhead bar height doesn't match the reference design** — a
  side-by-side shows the reference (target) bar noticeably slimmer/shorter
  than ours; asked to mimic it exactly rather than approximate.
- General impression: "everything feels very janky and not smooth" —
  likely partly *is* the concrete bugs above, but worth a dedicated pass
  once those are fixed to see what's left.

## Tasks

- [ ] Root-cause the camera zoom/scale regression — bisect whether it's
      `@react-three/fiber` v9's viewport computation, `drei` v10, or
      `three` 0.170's resize/camera behavior. Comparing against the actual
      pre-migration dependency set (e.g. a worktree checked out before
      `b878890`) will likely be faster than reasoning from changelogs alone.
- [ ] Fix the zoom to match production's scale — either by recalibrating
      `fov`/`CAMERA_Z`/the `zoom` formula once the mechanism is understood,
      or by finding and restoring whatever implicit behavior changed.
- [ ] Reproduce and fix the playhead fade-out — find what's actually
      driving it to render blank (likely `showPlayhead`/opacity state, but
      confirm rather than assume given it's a different moment than the
      choose-screen texture-loading issue already fixed).
- [ ] Fix the hover time-preview shadow/halo artifact on
      `MediaTimeRange`'s preview slot.
- [ ] Investigate and fix missing audio — check the `<video>` element's
      `muted` logic (currently forced true on localhost — confirm this
      isn't also somehow true in the reported case), whether the composed
      output actually has an audio track, and autoplay-policy interactions.
- [ ] Match the playhead bar's height/proportions exactly to the reference
      design.
- [ ] Once the above are fixed, do a dedicated pass on the general
      "janky/not smooth" feeling — identify specific remaining stutter/jank
      sources (spring configs, scroll damping, frame drops) rather than
      assuming it's fully explained by the bugs above.
- [ ] Re-verify against the live production reference after each fix.
- [ ] Move this doc to `plans/done/` once resolved and confirmed.

## Open questions

- Is the zoom regression best fixed by recalibrating our own camera formula
  empirically (faster, but papers over an unexplained library behavior
  change), or by fully root-causing the library-level change first (slower,
  more correct)?
- Does the height/proportions fix apply to the mobile (`xs:`) breakpoint
  too, or just desktop?
- Is "no audio" reproducible in every browser / for every dream, or does it
  depend on autoplay policy (first interaction required to unmute) in a way
  that's environment-specific rather than a real bug?
