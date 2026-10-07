import shutil
import subprocess
import tempfile
from pathlib import Path as P

import numpy as np
from cog import BasePredictor, Input, Path
from PIL import Image

PROPAINTER_DIR = "/src/ProPainter"


def to_frames(src: Path, out_dir: P, fps: float | None) -> int:
    """Decodes a video (or a single image) into out_dir/%04d.png via ffmpeg,
    which sniffs the container from content, so the input filename's
    extension never matters."""
    out_dir.mkdir(parents=True)
    args = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if fps:
        args += ["-r", str(fps)]
    args.append(str(out_dir / "%04d.png"))
    subprocess.run(args, check=True)
    return len(list(out_dir.glob("*.png")))


class Predictor(BasePredictor):
    def predict(
        self,
        video: Path = Input(description="Video to inpaint (any ffmpeg-readable container)"),
        mask: Path = Input(
            description="Mask video (one mask frame per video frame) or a single mask image applied to every frame. White = remove."
        ),
        fps: float = Input(description="Frame rate to decode at and encode the output with", default=24),
        mask_threshold: int = Input(
            description="Mask pixels above this (0-255) count as hole. Upstream treats any nonzero pixel as hole, so a soft/blurred mask would otherwise grow to its full blur extent.",
            default=128,
            ge=0,
            le=255,
        ),
        mask_dilation: int = Input(description="Extra dilation iterations upstream applies to the mask", default=4, ge=0),
        resize_ratio: float = Input(description="Processing scale (output is resized back to the input size)", default=1.0, ge=0.1, le=1),
        subvideo_length: int = Input(description="Frames per chunk for long videos (lower = less GPU memory)", default=80, ge=10),
        neighbor_length: int = Input(default=10, ge=2),
        ref_stride: int = Input(default=10, ge=1),
        fp16: bool = Input(description="Half precision (less GPU memory)", default=True),
    ) -> Path:
        work = P(tempfile.mkdtemp())
        frames_dir = work / "video"
        masks_dir = work / "mask"
        n = to_frames(video, frames_dir, fps)
        m = to_frames(mask, masks_dir, fps)
        if m != 1 and m != n:
            raise ValueError(f"mask has {m} frames but video has {n}; pass one mask frame per video frame, or a single image")

        for f in sorted(masks_dir.glob("*.png")):
            a = np.array(Image.open(f).convert("L"))
            Image.fromarray(((a > mask_threshold) * 255).astype(np.uint8)).save(f)
        if m == 1:
            # Upstream only broadcasts a single mask when given a file, not a
            # one-entry folder, so pass the file itself.
            mask_arg = str(next(masks_dir.glob("*.png")))
        else:
            mask_arg = str(masks_dir)

        out_root = work / "out"
        cmd = [
            "python", "inference_propainter.py",
            "--video", str(frames_dir),
            "--mask", mask_arg,
            "--output", str(out_root),
            "--resize_ratio", str(resize_ratio),
            "--mask_dilation", str(mask_dilation),
            "--subvideo_length", str(subvideo_length),
            "--neighbor_length", str(neighbor_length),
            "--ref_stride", str(ref_stride),
            "--save_fps", str(int(round(fps))),
            "--save_frames",
        ]
        if fp16:
            cmd.append("--fp16")
        subprocess.run(cmd, cwd=PROPAINTER_DIR, check=True)

        # Upstream names its output folder after the input's basename.
        out_frames = out_root / frames_dir.name / "frames"
        out_path = P("/tmp/inpaint.mp4")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-start_number", "0",
             "-i", str(out_frames / "%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-crf", "12", str(out_path)],
            check=True,
        )
        shutil.rmtree(work, ignore_errors=True)
        return Path(out_path)
