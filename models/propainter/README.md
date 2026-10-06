# ProPainter (Cog)

Our own Replicate deployment of [sczhou/ProPainter](https://github.com/sczhou/ProPainter),
temporally consistent video inpainting, for panel 3 (background). It
propagates real background from neighbouring frames along optical flow
instead of generating new content per frame. That means no prompt, and none
of the invented people, buildings or signatures that per-frame
`flux-fill-pro` needed review for.

Upstream is cloned at a pinned commit and its three checkpoints are baked
into the image (`cog.yaml`). Nothing is vendored here.

**Licence:** upstream is under the S-Lab License 1.0, which allows
**non-commercial** use only.

## Why not `jd7h/propainter`

That public wrapper failed for every Replicate-hosted input. Upstream picks
between "single image/video file" and "folder of frames" purely by the
path's extension (`read_mask`, `read_frame_from_videos`), and a Cog
download path doesn't reliably keep one. `predict.py` decodes both inputs
into PNG frame folders with ffmpeg first (ffmpeg detects the format from
the file's contents), so input filenames never matter.

## Inputs

- `video`: the video to inpaint (any ffmpeg-readable container).
- `mask`: a mask video with one frame per video frame, or a single image
  applied to every frame. White means remove.
- `mask_threshold` (128): upstream counts *any* nonzero pixel as hole, so
  a soft or blurred mask is binarized here first.
- `resize_ratio`, `subvideo_length`, `fp16`: memory controls for long or
  large clips.

Output: an H.264 MP4 (crf 12) at `fps`.

## Build / push

```
cd models/propainter
cog push r8.im/superhighfives/propainter
```
