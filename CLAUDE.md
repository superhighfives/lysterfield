# lysterfield

Baseline rules live in [superhighfives/control-room](https://github.com/superhighfives/control-room/blob/main/BASELINE.md).
This file is the repo-specific part.

## Layout

npm workspaces: `apps/client` (Vite/React/R3F player) and `apps/pipeline`
(Node/TS CLI, Replicate-driven, not yet ported — see
`plans/in-progress/rebuild-pipeline-as-replicate-cli.md`). Install and run
workspace scripts from the repo root with `npm run <script> --workspace=apps/<name>`.

## Generated assets — never commit

Per-scene output (`apps/client/dreams/<id>/...`: composited videos, loop
clips, preview JPGs) and any pipeline working directories (extracted frames,
per-step Replicate outputs) are generated, not source. They're already
gitignored in `apps/client`; keep the same rule for anything `apps/pipeline`
writes.

## Replicate calls cost money

Pipeline steps run over source video at up to 60fps and can mean thousands of
per-frame API calls for a single scene. Never add retry loops, "just try it
again" fallbacks, or code paths that call a Replicate model without an
idempotency check (skip-if-output-exists) guarding it first.

## The client's 7-panel output order is load-bearing, not a convention

`apps/client/src/materials/video-material.tsx` and `apps/client/src/views/main.tsx`
read a fixed `uFrameTotal={7}` atlas at hardcoded indices: 1 = lyrics,
2 = artwork, 3 = artwork background, 4 = matte, 5 = depth, 6 = outline,
7 = dream video. Don't reorder or resize the pipeline's composite output
without updating both those files to match.

## Secrets

`REPLICATE_API_TOKEN` and friends live in `apps/pipeline/.env`, never
committed. No hardcoded hostnames for local model servers (the old pipeline's
`superuniverse.local` — that pattern is retired, not ported).
