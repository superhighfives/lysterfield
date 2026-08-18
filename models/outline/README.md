# outline

Private Cog model wrapping the project's own ArtLine checkpoint — no public
Replicate port of [ArtLine](https://github.com/vijishmadhavan/ArtLine) exists
(confirmed via Replicate's search API and general web search, phase 2 of
[`rebuild-pipeline-as-replicate-cli.md`](../../plans/in-progress/rebuild-pipeline-as-replicate-cli.md)).

## Weights

Not committed (large binary, gitignored). Copy from the external drive
before building or predicting locally:

```sh
cp /Volumes/HDD/lysterfield-lake-pipeline/video-artline/torch_650.pkl .
```

This is the checkpoint the original pipeline's `other.py` actually loaded in
production (`torch_920.pkl` and the two `ArtLine_*.pkl` fastai-learner
originals also exist on the drive but aren't what shipped).

`fastai` is a required runtime dependency even though nothing here calls its
API directly — the checkpoint is `torch.save(learn.model, ...)`, and
unpickling a fastai `DynamicUnet` needs fastai's classes importable for
pickle's class resolution to succeed.

## Local test

```sh
cog predict -i image=@test.jpg
```

`test.jpg`/`reference-res.jpg` are the sample input/output from the
ArtLine-torch conversion project this checkpoint came from, for a quick
sanity check that the model still loads and produces line art.

## Status

Validated locally (CPU, `gpu: false` in `cog.yaml`) — checkpoint loads,
produces correct line art on both the sample fixture and a real production
frame. Not yet pushed to Replicate: that happens in phase 3 when
`outline.ts` needs a live endpoint to call, at which point flip `gpu: true`
for real per-frame throughput before pushing.
