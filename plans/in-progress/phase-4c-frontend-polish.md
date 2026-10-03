---
title: "Phase 4c: front-end polish — dark mode, depth shader, playback reliability, browser navigation"
status: In Progress
created: 2026-09-30
updated: 2026-10-02
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

- [x] Dark mode: system preference plus a manual toggle in the top-right
      link row; covers the 2D UI, page/canvas background, the shader's
      intro/outro fade colour, the choose screen's ink artwork and text,
      the welcome splash, and the loading strip.
- [x] Lyric text: `uBackgroundMix={0.5}` on the lyrics mesh blends its
      dream-video fill 50% toward black in light mode and white in dark
      mode. The first pass went the other way (toward the page colour);
      it was flipped on review because the contrasting colour reads
      better.
- [x] Depth shader: relief tapered to 0 at the silhouette edge with a
      quarter-circle profile computed from the avatar's own matte.
- [~] Depth shader: reworked on review, see "Depth, second pass" below.
      Tuned on **one** dream (`20230808103741`) only; still needs a check
      across several.
- [x] Polaroid frames go charcoal in dark mode (review feedback).
- [x] Carousel cards tilt toward the pointer one by one, with a stagger
      (review feedback).
- [x] Avatar sharpening: an unsharp mask on the portrait panel (review
      feedback).
- [x] Buffering: `isTooSlow` now runs on a per-stall timer that resets
      (see Implementation notes: it wasn't dead, it was broken).
      Prefetching looked at and not done.
- [x] Fixed the `load()`/`play()` race causing videos to stick on frame 0.
- [x] Browser back/forward: `?dream=<id>` URL plus `{ dream, t }` history
      state, restored on popstate and on cold load. All links stay
      same-tab (decision below).

## Decisions (were open questions)

- **Dark mode trigger**: both. A System / Light / Dark radio group sits
  in the top-right link row (icons, tooltips, arrow-key navigation) and
  defaults to System. The choice is saved in `localStorage.theme`, and an
  inline script in `index.html` applies it before first paint. The first
  pass was a two-state flip toggle; it became the explicit three-way
  control after review.
- **Dark mode scope**: the 2D UI plus the scene background, the lyric
  background and the shader's fade colour. The polaroid model's own
  materials are untouched.
- **Depth intensity target**: 0.2 world units at full depth (see Tasks:
  checked on one dream only).
- **Back/forward scope**: restore both the dream and its timestamp.
  `/about` gets no special handling. Coming back to the player is
  handled by the cold-load restore.
- **YouTube link tab behaviour**: no `target="_blank"` on any link. All
  stay same-tab and rely on the history restore.

## Implementation notes (deviations and findings)

- **The plan's claim that `isTooSlow` was dead was wrong.**
  `scene.tsx`'s `useFrame` did set it, from a `bufferingDelayRef` counter.
  That counter only ever went up, never reset, and counted every frame
  under `HAVE_FUTURE_DATA`. After 8s of total buffering in a session, the
  YouTube link was armed for every later stall, and `isTooSlow` never
  cleared. It's now a `setTimeout` in `root.tsx`, keyed on `isBuffering`:
  each stall gets a fresh 8s timer, and the flag clears when playback
  recovers.
- **Found a second "stuck" bug: the scene could hang on the loading
  screen forever.** `main.tsx`'s `suspend()` resolved only if
  `readyState === 4`, and otherwise waited for `loadedmetadata`. If it ran
  after `loadedmetadata` had already fired but before readyState reached
  4, it waited for an event that had already happened. This reproduced
  about one load in three in testing. It now resolves at
  `>= HAVE_METADATA`, the same state the listener waits for.
- **load/play race**: `main.tsx`'s separate `play()` effect is gone.
  `playhead.tsx` calls `load()` and then `play()` in one effect. On an
  `AbortError` it retries once on the next `canplay`. Other rejections,
  such as an autoplay-policy refusal, are logged and left to the play
  button. This is not a retry loop.
- **Depth shader**: kept the old flat `+0.05` offset and the `vUv.y` lean
  unchanged, since those are uniform and don't cause the slab look. The
  depth-map relief is now multiplied by `sqrt(1 - t²)`, where `t` is
  1 − "insideness". Insideness is the matte's average coverage over a
  5×5 vertex-shader neighbourhood (radius 0.06 UV), remapped so 0.5 → 0
  and 1.0 → 1. As a side effect, the relief is 0 outside the matte, which
  also removes zoedepth's corner flutter on the hidden part of the plane.
  The strength is the `uDepthStrength` uniform, set from `DEPTH_STRENGTH`
  in `main.tsx`.
- **Restore needs a scroll**: a dream restored from the URL arrives with
  the page scrolled to the top, but the player sits at the bottom. So
  `choose.tsx` scrolls drei's `ScrollControls` container to the bottom.
  drei ignores scroll events until one frame after it attaches its
  listener, so the jump is re-sent until `data.offset` actually moves.
- **Resume position** is stored as `{ dreamId, time }`, not a bare
  number. It's cleared only once the seek happens, so StrictMode's
  double-run of effects doesn't drop it. A later card click also can't
  inherit a stale resume time this way.
- **Position saving**: `replaceState` runs on `timeupdate`, at most once
  a second because Safari throttles at about 100 calls per 30s, and again
  on `pagehide`. If the page comes back from bfcache it resumes, but only
  if it was playing when the user left. In testing, Chrome never
  bfcached this WebGL page, so returning was always a cold load.
- **Dark-mode surfaces the plan didn't list**:
  - The choose screen's welcome, choose and scroll-hint PNGs are black
    ink on transparent. In dark mode they're inverted in the fragment
    shader via `onBeforeCompile`, with the material keyed on the scheme so
    it recompiles.
  - The polaroid title and prompt `<Text>` colours.
  - The welcome splash `<video>`, a colour photo on white. `multiply`
    would turn it black in dark mode, and `invert` would make it a
    negative, so dark mode uses an SVG `feColorMatrix` instead, which
    turns white into transparency.
  - The loading strip, which is greyscale, so a plain `invert` works.
- **Prefetching: not done.** Selecting a card already triggers `load()`
  in the same commit, so there's no real gap to close. Prefetching on
  hover would download multi-MB videos the viewer may never watch.

- **Carousel size on large screens** (added on review): the choose
  carousel is sized in world units, so it was the same share of the
  canvas height on any screen — enormous on a big monitor. The group
  around `Slider` now scales by `900 / canvasHeight`, clamped to
  [0.6, 1], so laptops are unchanged and a 1300px-tall canvas renders it
  at ~0.69×. Applied outside `Slider` on purpose: drei's `<Center>`
  measures in its own local space (it resets its own `matrixWorld`
  before `setFromObject`), so an ancestor scale doesn't disturb the
  offset it bakes at mount — unlike the Z-separation change reverted in
  a572be1.

- **Depth, second pass (review: "looks wrong, should read like a
  face").** The depth panel is coarse: bright means near, but a head
  comes through as one flat plateau. The first pass pushed that forward
  as-is and rounded it with a 5×5 matte window about as wide as the
  neck. Side-on, that showed as a block of a head on a pinched neck,
  which is the stretched face from the review screenshot.
  - The shape now comes from the depth panel blurred over 0.12 of the
    panel. Plateaus become rounded hills and the neck blends into the
    shoulders.
  - A thin roll-off (0.02) sits at the matte's edge.
  - Strength is 0.3.
  - The avatar mesh went from 500² to 256² vertices. That pays for the
    extra 50 texture samples per vertex and is still about one vertex
    per 4px of the 1024px panel.
  - The constants (`DEPTH_*`) are in `main.tsx`; the uniforms are
    `uShapeRadius` and `uEdgeRadius`.
  - The depth map has no facial relief (nose, brows), so "like a face"
    is limited to a well-shaped head. Real facial depth would need a
    better depth model in the pipeline.
- **Avatar sharpness.** Panels are 1024px, not 512px as an older shader
  comment says; the clamp inset there is just conservative. The
  softness is mostly at source: stylised output, then VP9 compression.
  An unsharp mask (`uSharpen`, 1.2, over 1.5 texels) firms up edges.
  Beyond that, sharper output needs pipeline work: higher-res panels,
  or a higher encoder bitrate for panel 2. The dithered sketch overlay
  (panel 6 multiplied at 0.3) also adds visible stipple on the face; that
  overlay is the existing look and was left alone.
- **Charcoal polaroids.** The frame materials are a white paper texture
  times `color`. Dark mode sets `#2b2826` on the three frame materials,
  which useGLTF shares across every instance; the paper grain survives.
- **Independent card float.** The review said the carousel moved "like a
  single stick moving from a central point" rather than 20 floating
  polaroids.
  - `Slider` wraps each card's contents in an inner group. That group
    tilts and drifts in x/y toward the pointer by its own amount (0.6-1.4×,
    from a golden-ratio per-index seed).
  - Each card also bobs on its own, in y and z, at its own speed and
    phase, so cards keep moving independently with the pointer still.
  - The lerp factor falls from 0.12 at the centre to 0.02 five
    card-widths out, so the motion ripples outward.
  - Half the rigid feel came from the camera: its pointer pan *and* its
    dolly (pointer Y zooms the whole scene) moved the row as one. Both
    are now halved while no dream is selected; the player keeps full
    parallax.
  - Verified by diffing two frames 1.5s apart with the pointer still and
    the carousel frozen: each card's outline moved by a different amount
    and direction.

- **Carousel card overlap (review: "still overlapping").** Neighbouring
  cards physically intersect: they're close, and rotated differently.
  With a shared depth buffer, the card in front was cut through along a
  jagged seam. The earlier fix, more Z separation (f245175), was
  reverted in a572be1 because `<Center>` freezes its offset at mount, so
  a steeper Z line pulls the centred card into the camera. Instead, the
  cards are now drawn as layers:
  - Each card's renderOrder comes from its rank, which is monotonic with
    Z. It's offset to 1000+ so it sits above the rest of the scene.
  - A per-card marker mesh clears the depth buffer just before that card
    draws. Depth is only tested within a card; between cards, draw order
    decides, and the front card paints cleanly over the one behind.
  - This needs every part of a card in the transparent pass, so carousel
    cards use transparent copies of the frame materials
    (`Polaroid layered`). The player's polaroid keeps the originals.
  - No geometry changed, so `<Center>` is unaffected.
- **Drop shadow (review: "can't see any shadow").**
  - Its plane (3.5×3.6) was smaller than the frame (3.66×4.47), so it was
    always hidden behind its own card.
  - Its texture faded canvas alpha, but `alphaMap` reads green, so it was
    a hard disc. Once visible, that looked like pixelated circles.
  - It's now a soft-edged rectangle (canvas `shadowBlur`, white on
    black), on a 5.6×6.6 plane nudged toward the card behind, at
    opacity 0.28. It's barely visible in dark mode (black on near-black);
    a light-mode-only effect in practice.
- **Glare (review: only on the left half's cards).** The first attempt
  was wrong. It moved the far light with the pointer, on the assumption
  that the glare was a specular highlight.
  - Measuring it showed otherwise. I diffed frames with the light on
    against light off, with the cards' bob frozen. The spotlight only
    lights the frames (the photos are unlit), and mostly diffusely: a
    frame is brightest when it faces the light. The fan turns right-hand
    cards to face left, so any light to the right lit the *left* half of
    the row brightest. Moving it right with the pointer made the reported
    bug worse.
  - On the choose screen, the light now sits at the camera and aims at
    the point under the pointer, with a soft cone (half-angle 0.85, full
    penumbra). Brightness follows a pool of light under the mouse.
    Verified with the pointer hard left vs hard right: the lit cards
    swap sides.
  - It eases back to the original fixed light (x=5, z=30, aimed at the
    origin) once a dream is selected.
  - Position and target moved out of JSX props into the light's
    construction, so a re-render can't reapply them mid-ease.
- **Dark-mode shadow and background (review).**
  - Carousel shadows are at opacity 0.8 in dark mode (0.28 in light).
    The player's polaroid keeps 0.28, where the stronger value read as a
    smudge, since there's no card behind it.
  - The page background is a radial "bowl" on `body` (`--bowl-centre` /
    `--bowl-edge` in `index.css`). In dark mode it's #24201e to #0c0a09;
    in light mode, a very subtle #fafaf9 to #eceae7.
  - The canvas is transparent, so the bowl shows through.
- **Cards draw over the heading (intended).** Since the layering draws
  cards last with depth cleared, cards paint over the "Where are we
  going?" heading wherever they overlap it, for example when the camera
  dollies in. I briefly lifted the heading above the cards; it was
  reverted on review, because covering the heading is the look we want.
  If something ever does need to draw over the carousel, it needs its
  renderOrder on a wrapping *group*: three.js sorts transparent objects
  by their nearest Group's renderOrder before their own. The slider's
  per-card ordering relies on the same rule.

- **White keying, round 2 (review: "white frost on the letters", the
  loading strip's black band).** Both now go through one shared SVG filter,
  `components/key-white-filter.tsx`, mounted once at the top of the app.
  It has three steps:
  - Coverage from inverted brightness, 4 × (2.88 − r − g − b). The zero
    point is exactly the strip's #f5f5f5 background. It's steep because
    both pieces of artwork have a lot of pale lettering just below that;
    gentler curves either left a faint band or keyed letters away.
  - A 1px choke. A brightness key reads a dark shape's soft edge (the
    splash's tree silhouettes against white) as fully opaque light grey,
    which was the frost.
  - Un-mixing the white with an arithmetic composite (pixel + coverage −
    1), so semi-transparent edges carry the letter's colour, not white.
  - The filter region is clipped to the element; Chrome painted the
    default 10% padding opaque black.
  - The loading strip is no longer inverted in dark mode. Its background
    is keyed out on its own layer behind the card (which gets explicit
    dark styles), so it sits on the page gradient in both modes.
  - On a slow connection the strip's JPEG paints top-down. That isn't
    new, but it looked like clipping while testing under throttle.
- **Gradients (review).** Dark is slightly darker: #1a1715 to #0a0908.
  Light is now inverted and very subtle: a little shade in the middle
  (#efedea) brightening to #fafaf9 at the edges.

## Open follow-ups (review round)

- **Glossy charcoal frames.** In dark mode, the player's polaroid (and
  carousel cards under the pointer's light) show a strong white specular
  streak. The frame materials are glossy (roughness 0.07-0.16). On white
  frames the streak was invisible. Raising roughness in dark mode would
  soften it, if it reads as too plasticky.

## Verified

Checked in an isolated Chrome instance against the local dev server, in
both schemes:

- welcome splash, loading strip, choose screen, player and toggle
- cold load of `?dream=…`: it scrolled to the player and autoplayed
- in-app home → back resumed at the saved time → forward went home
- leaving to another site → back cold-loaded the welcome screen with the
  URL and time intact → entering resumed at the saved time
- three reloads in a row with no loading hang

`tsc`, `lint` and `build` are clean.

**Not verified:**

- Safari, including the SVG-filter splash and its stricter autoplay
- mobile and touch
- a real network stall triggering the YouTube link
- depth on more than one dream

## Open follow-ups

- **Lyric legibility in light mode**: a 50% white mix over the
  polaroid's white lower border reads quite faint. Dark mode is fine.
  The amount is the `uBackgroundMix` prop in `main.tsx` if it wants
  tuning.
- **Pre-existing, not fixed here:** media-chrome sets `userinactive` on
  the controller at load, even with `autohide="-1"`. Until the pointer
  first moves, the control pill renders empty. That's unlikely when
  choosing a card, but likely after a URL restore where the viewer only
  clicks the welcome button.
