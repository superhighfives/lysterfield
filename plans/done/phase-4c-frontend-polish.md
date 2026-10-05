---
title: "Phase 4c: front-end polish — dark mode, depth shader, playback reliability, browser navigation"
status: Complete
created: 2026-09-30
updated: 2026-10-04
---

# Phase 4c: front-end polish — dark mode, depth shader, playback reliability, browser navigation

## Goal

A second front-end-only polish phase, after
[`plans/in-progress/phase-4b-player-and-choose-screen-polish.md`](../in-progress/phase-4b-player-and-choose-screen-polish.md).
Seven user-reported items with no shared root cause, spanning visual design
(dark mode, lyric-text contrast, depth shader shape/intensity), playback
reliability (buffering, stuck-on-first-frame), and navigation (browser
back/forward across links that leave the app). Bundled into one phase
document following this project's existing precedent (phase 4b bundled a
similarly varied set of unrelated polish items under one phase) — each item
below can still be picked off and worked independently; nothing here is
sequenced.

## Context

All seven items were verified against the current `apps/client` source
(post React-19-migration `main`, matching phase 4b's baseline) before
writing this spec, so the "Approach" sections below point at real code,
not guesses.

### 1. Dark mode support

No dark-mode infrastructure exists at all today:
- `tailwind.config.js` has no `darkMode` key (Tailwind defaults to
  `media`-strategy support being available, but nothing in the codebase
  uses a `dark:` variant anywhere — confirmed via grep).
- Every color is a hardcoded light-mode value: `background: '#f5f5f4'`
  (`tailwind.config.js`), `bg-white`/`text-stone-700`/`bg-yellow-400`
  throughout `root.tsx` and `playhead.tsx`, the shader's own hardcoded
  near-white `colorA`/`colorB` (`video-material.tsx`, see item 2).
- `index.css` has no `color-scheme` or `prefers-color-scheme` handling.

This is a from-scratch feature, not a bug fix — needs a design pass (which
surfaces get inverted colors, whether it's `prefers-color-scheme`-driven or
a manual toggle, where the toggle control would live) before implementation
starts. See Open Questions.

### 2. Lyric text opacity against light/dark background

The "text that animates in front of the polaroid" is the lyrics mesh in
`apps/client/src/views/main.tsx` (lines 254–267): a plane positioned
`[0, -0.4, 0.1]` inside the same `animated.group` as the polaroid (`z:
-1.0`), so it renders in front of it. It uses `videoMaterial` with
`uFrameSelected={7}` (samples the **dream video** panel as its color
source — not a static color), `uFrameMask={1}` (the lyric/word mask
texture gates alpha), `uInvert={1}`.

In `apps/client/src/materials/video-material.tsx`'s fragment shader:
- `image` (the text's fill color) is literally the sampled dream-video
  frame — full strength, no opacity mixing applied to it directly.
- `colorA`/`colorB` (lines 146–147, `vec3(0.912, 0.921, 0.929)` /
  `vec3(0.95, 0.95, 0.92)`) are a hardcoded near-white gradient used only
  for the intro/outro `fadeAmount` cross-fade (`image = mix(image, white,
  fadeAmount)`, line 195) — not a permanent background blend.
- `baseAlpha` (line 210) comes from the mask's red channel minus a small
  `maskIncrease` — this is the text shape's alpha, unrelated to the color
  mixing above.

The ask is a *permanent* 50%-opacity blend of the video color against a
flat background — white in light mode, black in dark mode — rather than
full-strength video color. This needs: (a) a mode-aware uniform (e.g.
`uBackgroundColor`, driven from whatever dark-mode state item 1
introduces), and (b) an unconditional `mix(backgroundColor, image, 0.5)`
applied to this material's `image` before the existing `baseAlpha`/
vignette logic — distinct from the existing time-based `fadeAmount` white
cross-fade, which should stay as-is for the intro/outro.

Depends on item 1 existing (need a dark-mode signal to feed the uniform).

### 3. Depth shader: round the avatar's edges

`video-material.tsx`'s **vertex** shader (lines 39–53) is the whole depth
effect:

```glsl
float fadeAmount = clamp((uTime / 4.0) - 1.25, 0.0, 1.0);
if(uFrameDepth != 0.0) {
  vec4 mask = texture2D(uTexture, vec2((vUv.x + (uFrameDepth - 1.0)) / uFrameTotal, vUv.y));
  float depth = ((mask.r + (vUv.y * 2.0)) / 8.0) * fadeAmount;
  intensity = (0.75 * depth + 0.05);
}
vec3 newPosition = vec3(position.x, position.y, position.z + intensity);
```

Only the avatar mesh sets `uFrameDepth` (`main.tsx` line 245, `uFrameDepth={5}`,
the depth-map panel) — the polaroid and lyrics meshes leave it at the
default `0`, so this only affects the 500×500-subdivided avatar plane
(`main.tsx` line 237).

Two separate, real issues with the current formula:
- **No rounding at the silhouette edge.** `intensity` has a flat `+0.05`
  floor applied everywhere on the plane, regardless of the depth map —
  there's nothing here that references the avatar's own alpha matte
  (`uFrameMask={4}`, used only in the *fragment* shader today to cut out
  the silhouette) to taper displacement back to `0` near the person's
  outline. The result is confirmed by the user's own description: the
  shape just pushes forward from a flat base rather than rounding off at
  the edges the way a real head/shoulders silhouette would. Fixing this
  means sampling the same mask texture already available (`uFrameMask`)
  in the vertex shader and using it to fade `intensity` toward `0` as
  `mask.r` (or distance-to-silhouette-edge) approaches the boundary —
  this is new vertex-shader logic, not a tweak to an existing falloff.
- **Overall intensity is tunable but currently modest** (item 4, below) —
  the `0.75` multiplier, `0.05` floor, and `/8.0` divisor are the three
  knobs; increasing the effect without first fixing the rounding above
  would just make the current flat-push-through look worse, not better.

### 4. Increase depth effect intensity

Same vertex shader location as item 3. Current effective range: `depth`
(before fade-in) is `(mask.r + vUv.y*2.0) / 8.0`, so roughly `0` to `0.375`
depending on `mask.r ∈ [0,1]` and `vUv.y ∈ [0,1]`; `intensity` then scales
that by `0.75` and adds a `0.05` floor, giving a final range of roughly
`0.05` to `0.33` world units of forward push. Raising this (larger
multiplier, and/or removing the fixed `/8.0` divisor's compression) is a
one-line constant change *after* item 3's edge-rounding logic is in place
— doing it before would just exaggerate the current flat-push look.

### 5. Loading/buffering reliability

Current state (already partially instrumented, from phase 4b's own work):
- `playhead.tsx` wires `loadedmetadata`/`loadeddata`/`canplay`/
  `canplaythrough`/`waiting`/`stalled`/`emptied` into a single
  `videoState` store field mirroring `HTMLMediaElement.readyState`
  (lines 65–90).
- `root.tsx` derives `isBuffering = videoState < HAVE_FUTURE_DATA`
  (lines 35–42) and shows a "Buffering..."/"Loading video..." pill
  (lines 80–104), plus an `isTooSlow` store flag that reveals a "Watch on
  YouTube?" escape-hatch link (lines 94–103) — but nothing in the codebase
  currently *sets* `isTooSlow` (confirmed via grep: `setIsTooSlow` exists
  in `store.ts` but has no call site anywhere in `src/`) — it's dead
  wiring, a plausible contributor to the "seems iffy" impression, since
  the escape hatch this state is meant to drive never actually appears no
  matter how long buffering lasts.
- The `<video>` element uses `preload="auto"` (`playhead.tsx` line 240)
  but nothing prefetches the *next likely* dream's video ahead of
  selection — the choose-screen only preloads `hero.jpg` thumbnails
  (`choose.tsx` line 36), not any part of the actual playback video.
- `waiting`/`stalled` are folded into the same generic `videoState`
  number as every other readyState event — there's no distinct
  stall-timeout/retry path, so a real network stall and a normal initial
  load look identical to the UI.

Concrete gaps worth closing: wire up `isTooSlow` to something real (e.g. a
timer that flips it if `isBuffering` stays true past some threshold —
matching what the dead UI already implies was intended), and consider
prefetching the selected dream's video (or at least kicking off its
`load()` earlier) rather than waiting for the dream-selection effect.

### 6. Videos sometimes stuck on the first frame

Found a real race, not just a vague "iffy" feeling. Two separate effects,
in two separate components, both key off `[dream]` and run independently
with no coordination:
- `playhead.tsx` line 52–54: `useEffect(() => { ref.current.load() },
  [dream])` — `HTMLMediaElement.load()` aborts any in-flight load and
  resets `readyState` back to `HAVE_NOTHING`.
- `main.tsx` line 44–49: `useEffect(() => { if (dream?.id)
  videoElement.play() }, [dream])` — calls `.play()` directly, with
  **no `.catch()`** on the returned promise.

React doesn't guarantee effect ordering between these two sibling-rendered
components relative to each other on every render. If `main.tsx`'s
`.play()` call fires while or just after `playhead.tsx`'s `.load()` call
has reset the element, the browser can reject the play promise (a load
interrupting a pending play is a well-known rejection case in every
browser's media spec) — and since nothing observes that rejection, it's
silently swallowed. The element is left paused on frame 0 with no retry,
matching the reported symptom exactly. Fixing this needs either: (a)
sequencing — only call `.play()` after the `.load()` call's own
`loadedmetadata`/`canplay` event, not from an independent effect racing
against it, or (b) a `.catch()` on `.play()` that retries (e.g. on the
next `canplay` event) instead of giving up silently.

### 7. Browser back/forward navigation

Confirmed via grep: **nothing in this codebase touches
`history`/`location.pathname`/`popstate`** — there is no router. Dream
selection (`choose.tsx`'s `setDream()`) is pure Zustand state with no URL
change at all. Two places link away from the SPA entirely, as a normal
same-tab navigation (no `target="_blank"` on either):
- `root.tsx` line 94: `<a href={dream?.link}>` — "Watch on YouTube?"
  escape hatch, shown during buffering/stalls.
- `root.tsx` line 63: `<a href="/about">` — and `/about` itself has **no
  corresponding route or component anywhere in `apps/client/src`**, so
  whatever renders at that path in production is outside this repo (or
  unbuilt) — out of scope to investigate further here, since the ask is
  about *returning* to the player, not about `/about`'s own content.

Since there's no SPA routing today, pressing back after either link
currently reloads `index.html` from scratch — the user lands back on the
cold-start welcome/choose screen, having lost which dream was selected and
where playback was. Making back/forward "put you right back in the video"
needs real state to restore from on return: at minimum the selected
dream's `id` pushed via `history.pushState`/read on `popstate` (and
probably on initial load, so a shared/bookmarked URL also works), plus
enough playback position (`video.currentTime`) to resume meaningfully
rather than just re-selecting the same dream from `0:00`. This is a
genuine feature addition (there's no history-API usage to build on), not
a one-line fix.

## Approach

Each item is independent; suggested order only groups related shader work
together (3 before 4) and flags the one real dependency (2 needs 1):

1. **Dark mode** — resolve the open questions below first (toggle vs.
   `prefers-color-scheme`, scope of surfaces), then add Tailwind
   `darkMode` config + `dark:` variants across `root.tsx`/`playhead.tsx`/
   `tooltip.tsx`/`footer.tsx`, plus a dark-mode-aware signal (store field
   or a `useMediaQuery`/CSS-variable read) that item 2's shader uniform
   can consume.
2. **Lyric text opacity** — add a mode-aware background-color uniform to
   the lyrics `videoMaterial` instance in `main.tsx`, and change the
   fragment shader's handling of that mesh's `image` to an unconditional
   50% mix against it, leaving the existing time-based white cross-fade
   (`fadeAmount`) intact for the intro/outro.
3. **Round the avatar depth edges** — extend the vertex shader to sample
   the avatar's own alpha-matte (`uFrameMask`) and taper `intensity`
   toward `0` near the silhouette boundary, replacing the current flat
   `+0.05` floor.
4. **Increase depth intensity** — once 3 lands, raise the multiplier/
   divisor constants and check the result against a few different dreams
   (depth maps vary per scene) to pick values that read as "more intense"
   without clipping into the camera or looking distorted.
5. **Buffering/loading reliability** — wire `isTooSlow` to an actual
   timeout condition instead of leaving it dead, and look at prefetching/
   starting `load()` on the selected dream's video earlier (e.g. as soon
   as a card is clicked, rather than only from the existing dream-change
   effect).
6. **Stuck-on-first-frame fix** — remove the race between `playhead.tsx`'s
   `load()` effect and `main.tsx`'s `play()` effect: either gate the
   `play()` call on a `canplay`/`loadeddata` event fired after `load()`,
   or add retry-on-rejection handling to the existing `.play()` call.
7. **Browser back/forward** — introduce minimal history-API usage: push a
   state entry (dream id, and ideally `currentTime`) when a dream is
   selected, restore from it on `popstate` and on initial mount (so a
   direct/bookmarked URL also works), and change the YouTube link to open
   in a new tab (`target="_blank" rel="noopener"`) if that turns out to be
   an acceptable simpler fix for that specific case — see Open Questions.

## Tasks

The original seven:

- [x] Dark mode: system preference plus a System / Light / Dark control.
- [x] Lyric text: a 50% blend of the dream-video fill toward a contrasting
      flat colour.
- [x] Depth shader: edge rounding.
- [x] Depth shader: stronger, reshaped relief. Checked across five dreams
      and several poses.
- [x] Buffering: `isTooSlow` fixed (it was broken, not dead). Prefetching
      looked at and not done.
- [x] The load/play race that left videos stuck on frame 0.
- [x] Browser back/forward: URL plus history state, with resume.

Added during review:

- [x] Scene-wide dark mode: charcoal polaroids, ink artwork, splash and
      loading strip, and a "bowl" background gradient in both schemes.
- [x] The carousel: scales down on tall screens, sits closer to the
      camera, and its cards float, turn toward the cursor and draw as
      layers with soft drop shadows.
- [x] Choose-screen lighting: a pointer-aimed spotlight, white frames in
      light mode, and no glare in dark mode.
- [x] Fireflies/gnats: they scatter while a video plays and have scroll
      parallax.
- [x] Avatar sharpening.
- [x] The control pill rendered empty until the first pointer move (an
      existing media-chrome issue that URL restore made common).
- [x] Removed the two 15-second example dreams.

## Decisions (were open questions)

- **Dark mode trigger**: both. A System / Light / Dark radio group in the
  top-right link row, defaulting to System. The choice is saved in
  `localStorage.theme`, and an inline script in `index.html` applies it
  before first paint.
- **Dark mode scope**: everything visible. That covers the 2D UI, the page
  background, the shader's fade colour, the lyric fill, the polaroid
  frames (charcoal), the choose-screen ink and text, the splash, the
  loading strip and the lighting.
- **Depth intensity target**: 0.3 world units at full depth, on a
  reshaped surface (see Architecture). That's not a straight constant
  bump.
- **Back/forward scope**: restore both the dream and its timestamp.
  `/about` gets no special handling; returning from it is a cold-load
  restore.
- **External links**: all stay same-tab and rely on the history restore.
  No `target="_blank"`.

## Overview

Phase 4c set out as seven independent front-end fixes: dark mode, lyric
contrast, avatar depth shape and strength, buffering, stuck-on-first-frame
playback, and browser back/forward. It grew, through several rounds of
review, into a broader polish pass on the choose screen and the scene's
look.

Everything shipped in `apps/client`, front-end only. The pipeline is
untouched apart from moving two example dreams' generated output into
`dreams/archive/`.

The main shifts from the spec, each explained under Architecture:

- `isTooSlow` was broken rather than dead.
- A second stuck bug was found: the loading screen could hang forever.
- The depth surface was rebuilt twice, because the depth panel turned
  out too coarse to use directly.
- The carousel's overlapping cards needed per-card depth layering,
  because the obvious fix (Z spacing) breaks drei's `<Center>`.
- The choose-screen lighting was reworked from measurement, after a
  first attempt made the reported bug worse.

## Architecture

### Dark mode

- **State:**
  - `utils/theme.ts` handles read/write/resolve and applies `.dark` plus
    `color-scheme` on `<html>`.
  - The store holds `themePreference` (what the user picked) and
    `colorScheme` (resolved).
  - `components/theme-toggle.tsx` is the radio group. It also keeps the
    class and store in sync, and follows the OS while set to System.
  - Tailwind uses `darkMode: 'class'`.
  - `index.html` has a pre-paint script that mirrors `theme.ts`, so there
    is no flash.
- **Shaders:**
  - `video-material.tsx` takes `uDark`, which picks the intro/outro fade
    colour.
  - `uBackgroundMix` (lyrics only, 0.5) blends the lyric fill toward
    black in light mode and white in dark mode. The spec had it the
    other way round; review flipped it, because the contrasting colour
    reads better.
- **Page:**
  - The `body` background is a radial "bowl" (`--bowl-centre` /
    `--bowl-edge` in `index.css`). Dark mode goes from #1a1715 to
    #0a0908. Light mode is inverted and subtle, #efedea to #fafaf9.
  - The canvas is transparent over it.
- **Artwork:**
  - The choose screen's black-ink PNGs are inverted in dark mode with an
    `onBeforeCompile` patch, and the material is keyed on the scheme.
  - The splash video and the loading strip are both shot on white. Both
    go through `components/key-white-filter.tsx`, an SVG filter mounted
    once:
    - coverage from inverted brightness, 4 × (2.88 − rgb), zeroed exactly
      at the strip's #f5f5f5;
    - a 1px choke, because dark silhouettes' soft edges otherwise read as
      opaque light grey (the "frost");
    - an arithmetic composite that un-mixes the white;
    - the region clipped to the element, because Chrome painted the
      default padding black.
  - The loading card has explicit dark styles; it's no longer inverted.
- **Polaroids:** frames are tinted `#2b2826` in dark mode (white paper
  texture × colour). That covers the shared GLTF materials and the
  carousel's copies, described below.

### Avatar depth (`video-material.tsx` vertex shader; constants in `main.tsx`)

The depth panel is coarse: bright means near, and a head comes through as
one flat plateau.

- **First pass:** pushed that plateau forward with a quarter-circle edge
  taper over a 5×5 matte window. Side-on it read as a block of a head on
  a pinched neck.
- **What shipped:**
  - **Shape:** the depth panel blurred over 0.12 of the panel
    (`DEPTH_SHAPE_RADIUS`), so plateaus become rounded hills and the
    neck blends into the shoulders.
  - **Edge roll-off:** a smoothstep over 0.04 (`DEPTH_EDGE_RADIUS`). A
    quarter circle goes vertical at the outline, and those triangles
    smeared the outline's pixels (an ear stretched sideways) at ordinary
    tilt angles.
  - **Strength:** 0.3 (`DEPTH_STRENGTH`).
  - **Lean:** the original lean and +0.05 offset are kept.
  - **Mesh:** cut from 500² to 256² vertices, to pay for the extra
    samples.
  - The relief is 0 outside the matte, which also removes zoedepth's
    corner flutter.
- **Checked:**
  - All five dreams share source footage, so their depth panels match;
    the variation is across poses, not dreams.
  - Verified side-on and at ±0.3 rad, at 0:40, 1:35 and 2:30.
- **Limit:** the depth map has no facial relief (nose, brows), so the
  best achievable is a well-shaped head.
- **Sharpening:** an unsharp mask on the portrait (`uSharpen` 1.2, 1.5
  texels).
  - Panels are 1024px on desktop and 512px in `video-small`. The
    softness is mostly at source (stylised output, then VP9).
  - The dithered sketch overlay's stipple is the existing look.

### Playback reliability

- **Stuck on frame 0:** `load()` and `play()` now run in one effect in
  `playhead.tsx`, in that order. They used to be two racing effects in
  two components. An `AbortError` retries once on the next `canplay`;
  other rejections are logged and left to the play button.
- **Loading-screen hang:** `main.tsx`'s texture `suspend()` resolved only
  at `readyState === 4`, otherwise waiting for `loadedmetadata`. If
  metadata had already arrived, it waited forever; this reproduced about
  one load in three. It now resolves at `>= HAVE_METADATA`.
- **`isTooSlow`:** `scene.tsx` did set it, from a counter that only
  counted up and never reset. It's now an 8s `setTimeout` per stall in
  `root.tsx`, and it clears on recovery.
- **Prefetching:** not done. A card click already starts `load()`, and
  prefetching on hover would download multi-MB videos that may never be
  watched.
- **Empty control pill:** media-chrome sets `userinactive` when it
  connects, even with `autohide="-1"`, and only clears it on a pointer
  move. The control row now carries `noautohide`, which its hiding CSS
  skips.

### Back/forward (`utils/use-history-sync.ts`)

- **URL and state:** the URL carries `?dream=<id>`, and the history entry
  carries `{ dream, t }`.
- **Pushing:** any dream change the URL doesn't already reflect pushes an
  entry; restores don't push duplicates.
- **Restoring:** happens on `popstate`, and once the player is ready
  after a cold load (the welcome click is needed for audio and
  orientation).
- **Resume:** stored as `{ dreamId, time }` and cleared only once the
  seek happens, so it survives StrictMode and can't leak to another
  dream.
- **Saving position:** `replaceState` on `timeupdate`, at most once a
  second (Safari's limit), plus on `pagehide`.
- **bfcache:** a restore from bfcache resumes only if the video was
  playing. Chrome never bfcached this WebGL page in testing.
- **Scroll:** `choose.tsx` scrolls drei's `ScrollControls` to the player,
  re-announcing the scroll until `data.offset` moves (drei ignores
  scroll events for its first frame).

### Choose-screen carousel

- **Size and placement:**
  - The group around `Slider` scales by `900 / canvasHeight`, clamped to
    [0.6, 1].
  - It sits `CAROUSEL_FORWARD` = 0.25 toward the camera.
  - The camera is pulled back from 1.5 to 1.8 (`CAMERA_Z`); layout is in
    viewport units, so only sizes change.
  - Everything is applied *outside* `Slider` deliberately. drei's
    `<Center>` measures once, in its own local space, so changing
    geometry inside it is what caused the zoom regression reverted in
    a572be1.
- **Motion:** each card's contents sit in an inner group (`Slider`).
  - That group turns toward the cursor: the angle from the card's world
    position to the pointer on z=0, ×0.5, capped at 0.4 rad.
  - It also drifts toward the pointer by its own amount (0.6-1.4×, from a
    per-index seed) and bobs on its own.
  - Easing falls from 0.12 at the centre to 0.02 five cards out, so
    motion ripples outward.
  - The camera's pan and dolly are halved while choosing; the rigid
    whole-row motion came from there.
- **Overlap:** neighbouring cards physically intersect, so with a shared
  depth buffer the front card got cut through. Cards now draw as layers:
  - renderOrder `1000 + rank × 2`; rank is monotonic with Z;
  - a per-card marker mesh clears depth just before its card;
  - every part is in the transparent pass, so `Polaroid layered` uses
    transparent copies of the frame materials;
  - three.js sorts transparent objects by their nearest *Group's*
    renderOrder first, so the orders sit on groups.
  - Cards painting over the "Where are we going?" heading is intended
    (review).
- **Shadows:**
  - The drop shadow was smaller than its own frame, and its alpha map
    faded canvas alpha while `alphaMap` reads green (a hard disc). It's
    now a soft-edged rectangle larger than the card, nudged toward the
    card behind.
  - Opacity: 0.16 in light mode; 0.8 for carousel cards in dark mode
    (0.28 for the player's polaroid).
  - Carousel cards are excluded from the spotlight's shadow map; with
    the light aimed sideways, those shadows came out low-res and jagged.

### Choose-screen lighting (`scene.tsx`)

- **What measuring showed:** I diffed light-on frames against light-off
  ones, with the cards' bob frozen. The spotlight lights the frames
  (photos are unlit), mostly diffusely. The fan turns right-hand cards to
  face left, so any light to the right lit the *left* half brightest. A
  first attempt that moved the far light with the pointer made that
  worse.
- **What shipped:**
  - While choosing, the light sits at the camera and aims at the point
    under the pointer: a soft cone (half-angle 0.85, full penumbra).
  - It eases back to the original fixed light (x=5, z=30) for the
    player.
  - Its position and target are set at construction rather than as JSX
    props, so a re-render can't reset them mid-ease.
- **Grey/olive frames in light mode:** ACES tone mapping pulls white
  paper down, and three.js's ambient light delivers intensity ÷ π. The
  carousel copies set `toneMapped = false`, and the levels are per
  scheme (`CHOOSING_LIGHT`):
  - light: ambient 2.6, spot 2.5. Near-white paper, with the pool
    clipping to white.
  - dark: ambient 2.6, spot 0.6, with matte frame copies (roughness
    0.75), because glossy glare read as over-bright cards.

### Fireflies (`components/fireflies.tsx`)

- **Look:** a points shader. Each bug wanders on slow seeded sines, with
  a fast jitter and a flicker. Warm and additive in dark mode; small
  dark gnats with normal blending in light mode.
- **Layers:**
  - 70 behind: depth-tested, and drawn before the card layers.
  - 12 in front: drawn last with no depth test.
- **Scatter:** `uScatter` flies them radially out of frame while a video
  plays (staggered, accelerating). They return fast (damp 5, against 0.8
  out), and "resetting" counts as stopped, so they're home before the
  polaroids slide up.
- **Scroll parallax:** they sit inside `ScrollControls` but outside
  `<Scroll>` and move at 0.35× (back) and 0.8× (front) of the scroll,
  wrapping in a band 1.3× the viewport's height.
- **Reduced motion:** skipped entirely under `prefers-reduced-motion`.

### Content

- The `dream-v1` and `dream-styletransfer-v2-fixed` examples were
  removed: their `dreams.json` entries and committed assets.
- `generate-dreams.js` rebuilds `dreams.json` from the local `dreams/`
  folders, so their generated folders in the main checkout moved to
  `dreams/archive/`, which the generator skips.

## Verified

Checked in an isolated Chrome against the local dev server, in both
schemes:

- **Screens:** welcome splash, loading strip, choose screen, player,
  theme control.
- **Restore and navigation:**
  - cold `?dream=` load scrolls to the player and autoplays;
  - in-app back/forward resumes;
  - leaving the site and coming back resumes at the saved time;
  - no loading hang across repeated reloads.
- **Choose screen:** carousel lighting at both pointer extremes; card
  layering and shadows.
- **Avatar:** depth across five dreams and several poses.
- **Fireflies:** scatter and return.
- **Control pill:** shows with no pointer movement.

`tsc`, `lint` and `build` are clean.

**Not verified:**

- Safari, including the SVG key filter and stricter autoplay
- mobile and touch, including the GPU cost of the depth shader and
  fireflies
- a real network stall triggering the YouTube link

## Follow-ups

- **The player polaroid's glossy frame in dark mode** still shows a white
  specular streak from the original fixed light. The matte treatment
  only applies to carousel cards. Easy to extend if it reads as
  plasticky.
- **Light-mode frames are faintly warm** (the paper texture), now that
  tone mapping no longer greys them. They can be neutralised if pure
  white is wanted.
