---
title: Cheap pre-production preview/approval loop for dream art direction
status: Backlog
created: 2026-09-30
updated: 2026-09-30
---

# Cheap pre-production preview/approval loop for dream art direction

## Goal

Let a dream (panel 7) art direction get validated on a handful of cheap
sample frames before committing to a full per-scene dream run, and let a
full scene get a short test-clip review in the actual app before it's
accepted as final.

## Context

Motivated directly by `real-15s-60fps`: two full dream takes
(`dream-styletransfer-v2`, `dream-styletransfer-v2-fixed`) were each run to
completion (~91 real `flux-kontext-dev` calls, ~$2.73) before anyone could
tell they showed a person and didn't work — see
`plans/done/phase-5-end-to-end-parity-check.md` and the `NO_PEOPLE_SUFFIX`
fix in `dream.ts`. There's currently no cheap way to preview a prompt/style
direction before paying for a full-scene run. Panels 1–6 are unaffected by
this — they're shared/deterministic across takes (see conversation
2026-09-30) — this tool is specifically about panel 7's creative direction.

## Approach (rough — not scoped yet)

1. Given a source frame + a short text description, use Claude to propose
   a handful of abstract visual directions, each with an accompanying
   colour palette.
2. For a chosen direction, generate a small batch (5) of sample dream
   frames (via the real `dream` step / `flux-kontext-dev`, same
   `NO_PEOPLE_SUFFIX` guarantee) from representative source frames.
3. Show the 5 frames as a film-strip for approve/deny.
4. On approval, generate a short (~15s) test clip through the full
   composite (reusing the job's existing panels 1–6) and preview it in the
   real app before committing.
5. Only once that clip is approved does the scene go through the full
   dream generation sequence (full length/fps).

## Tasks

- [ ] Scope a v1 (see open questions below) and move to `ready/`

## Open questions

- UI: a Claude Artifact (fast, no auth, ephemeral) vs. a small `/admin`
  route in `apps/client` (dev-only to start, real auth deferred)?
- Who generates the creative-direction brainstorm — a Claude API call
  wired into `apps/pipeline`, or done conversationally in Claude Code each
  time, with no new product surface at all?
- Eventually online (would need auth), or dev-only indefinitely?
- How do the "5 sample frames" relate to `dream.ts`'s existing
  `stepFps`/keyframe mechanism — pull from a real job's early keyframes, or
  a dedicated scratch frame set outside the `.jobs/<name>` layout?
