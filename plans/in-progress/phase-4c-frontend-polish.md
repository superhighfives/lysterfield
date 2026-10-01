---
title: "Phase 4c: front-end polish — dark mode, depth shader, playback reliability, browser navigation"
status: In Progress
created: 2026-09-30
updated: 2026-09-30
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

- [ ] Dark mode: scope which surfaces get dark variants, pick
      toggle-vs-`prefers-color-scheme`, implement.
- [ ] Lyric text: mode-aware background uniform + 50% video-opacity mix
      in the lyrics `videoMaterial` fragment shader path.
- [ ] Depth shader: round the avatar silhouette's edges using its existing
      alpha matte, replacing the current flat intensity floor.
- [ ] Depth shader: increase overall intensity once edge-rounding is in,
      tuned across multiple dreams.
- [ ] Buffering: wire up the currently-dead `isTooSlow` flag to a real
      timeout; evaluate prefetching the selected dream's video earlier.
- [ ] Fix the `load()`/`play()` race between `playhead.tsx` and
      `main.tsx` causing videos to stick on frame 0.
- [ ] Browser back/forward: push/restore dream selection (and ideally
      playback position) via the History API; evaluate `target="_blank"`
      for the YouTube link as a simpler complementary fix.

## Open questions

- **Dark mode trigger**: automatic via `prefers-color-scheme`, a manual
  toggle control (and if so, where — the top-right link row in
  `root.tsx` is the only persistent chrome today), or both? Affects
  whether item 1 needs new UI at all.
- **Dark mode scope**: does it need to reach into the 3D scene itself
  (background color, polaroid/avatar material tints) or just the 2D
  chrome (buttons, pills, links) plus the lyric-text background from
  item 2? The user's own ask only explicitly covers the lyric text; the
  rest of the dark-mode surface area needs scoping before implementation.
- **Depth intensity target**: "more intense" has no numeric target yet —
  needs an eyeballed pass against a few real dreams once edge-rounding
  (item 3) is in, not a blind constant bump beforehand.
- **Back/forward scope**: does "right back in the video" mean resuming
  at the same timestamp, or just re-landing on the same dream (restarting
  playback) being good enough? Also unclear whether `/about` needs the
  same treatment given it isn't part of this app's own build (see
  Context, item 7) — may be entirely out of scope, pending confirmation.
- **YouTube link tab behavior**: opening it in a new tab (`target=
  "_blank"`) would sidestep the back-button problem for that specific
  link entirely, with no history-API work needed — worth confirming
  whether that's an acceptable fix for that case specifically, separate
  from the more general back/forward support the user is also asking for
  (which the dream-selection flow needs regardless, since that never
  leaves the SPA today but still has no shareable/restorable URL state).
