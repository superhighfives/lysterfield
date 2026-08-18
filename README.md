# lysterfield

Unified repo for the Lysterfield Lake music video project: the client that
plays it, and the pipeline that generates its per-scene assets.

## Layout

| Directory | Purpose |
| --- | --- |
| `apps/client` | Vite/React/R3F app that plays the video, reading a static `dreams/<id>/...` folder per scene (formerly `lysterfield-lake`) |
| `apps/pipeline` | Node/TypeScript CLI that turns one iPhone video into a scene's assets via Replicate (formerly `lysterfield-lake-pipeline`, not yet ported) |
| `plans/` | Implementation plans, tracked through `backlog/ → ready/ → in-progress/ → done/` per the `plans` skill |

See `plans/in-progress/rebuild-pipeline-as-replicate-cli.md` for the
architecture and phasing behind this repo.

## Workspace

npm workspaces, one package per `apps/*`. Install from the root:

```sh
npm install
```
