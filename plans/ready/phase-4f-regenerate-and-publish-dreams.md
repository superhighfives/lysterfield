---
title: "Phase 4f: regenerate and publish all ten dreams from .jobs/full-video"
status: Ready
created: 2026-10-09
updated: 2026-10-09
---

# Phase 4f: regenerate and publish all ten dreams from `.jobs/full-video`

## Goal

Compose all ten dreams through the new pipeline from `.jobs/full-video`,
review them, and replace the published 2023 videos with them, under the
readable ids the client now uses.

## Context

[Phase 4e](../done/phase-4e-full-video-source-prep.md) built every panel for
the whole song and imported the ten legacy dreams into
`.jobs/full-video/7-dreams/<id>/`. `lush-and-light` has been composed once
with `--skip-client true` and approved by the user, but that render predates
the stray-frame fixes (panel 2 frames 142 and 802, panel 3 frame 142), so it
needs composing again.

The client already uses the readable ids (`watercolour`, `paper-planes`,
`clouds-of-air`, `dirty-palette`, `horizon-storm`, `lush-and-light`,
`ghiblis-dream`, `mood-lighting`, `ink-flight`, `charcoal`), but its local
`apps/client/dreams/<id>/` folders and the R2 dreams bucket still hold the
old 2023 videos, and **R2 still has them under the datestamp ids**. So a
deployed client from the `matte-panel-folder` branch would request videos
that don't exist on R2 until this plan's sync runs.

Compose is local and free (no Replicate calls). One dream took about 25
minutes, mostly the VP9 `.webm` encodes.

## Approach

1. Compose each dream:
   `bun run src/cli.ts compose --job .jobs/full-video --take <id>`. Without
   `--skip-client` this also publishes: videos to
   `apps/client/dreams/<id>/`, and `hero.jpg`, `loop.mov/.webm` and
   `00-03.jpg` to `apps/client/public/assets/<id>/`. `dreams.json` already
   has every id, so its titles, links and prompts are kept. Everything is
   also in `.jobs/full-video/7-dreams/<id>/final/`.
2. Review each composite: check panel 7 against the old video at a few
   exact frames (by frame number; `-ss` seeks are imprecise), and watch at
   least one end to end for stray frames in matte, depth or outline, which
   the size scan can't clear.
3. `bun run --cwd apps/client deploy-dreams` (an `rclone sync` to the
   `lysterfield-lake-dreams` R2 bucket). This uploads the new id folders
   and deletes the datestamp ones. **Needs the user's go-ahead**: it changes
   the live site's video hosting.
4. Deploy the client.

## Tasks

- [ ] Compose all ten dreams (re-compose `lush-and-light` too)
- [ ] Review: panel 7 timing per dream, plus a full watch of at least one
- [ ] Decide whether old `?dream=<datestamp>` links need a redirect
- [ ] Sync R2 (`deploy-dreams`), with the user's go-ahead
- [ ] Deploy the client
- [ ] Optional: review `repairGlitchedFrames`'s 80 flagged matte frames on
      this job, or tune the detector (see phase 4e's Other fixes)

## Open questions

- Do old shared links with datestamp ids matter? If so, add an old-id →
  new-id lookup in `use-history-sync.ts`.
- Keep the 2023 originals anywhere besides the HDD's `output/final/`?
