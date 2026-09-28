#!/usr/bin/env bash
# One-time migration: moves a job directory from the old
# static/frames/<name> + dynamic/<take>/frames/dream layout to the new
# numbered per-panel layout (source/alpha/video at the job root,
# 2-portrait through 6-outline shared, 7-dreams/<take>/frames per take).
# Safe to re-run — every mv is skipped if its source no longer exists.
#
# Usage: scripts/migrate-job-layout.sh <job-dir> [take ...]
# Example: scripts/migrate-job-layout.sh .jobs/real-15s-60fps dream-v1 dream-styletransfer-v2 dream-styletransfer-v2-fixed

set -euo pipefail

job_dir="${1:?Usage: $0 <job-dir> [take ...]}"
shift
takes=("$@")

cd "$job_dir"

move() {
  local from="$1" to="$2"
  if [ -e "$from" ]; then
    mkdir -p "$(dirname "$to")"
    mv "$from" "$to"
    echo "moved $from -> $to"
  fi
}

mkdir -p video 2-portrait 3-background 5-depth 6-outline 7-dreams legacy

move static/frames/source source
move static/frames/alpha alpha
move static/frames/artwork 2-portrait/raw
move static/frames/artwork-upscaled 2-portrait/upscaled
move static/frames/background-stable 3-background/stable
move static/frames/depth 5-depth/frames
move static/frames/outline 6-outline/frames

move static/video/cropped.mov video/cropped.mov
move static/video/original.mov video/original.mov
move static/video/full.mov video/full.mov
move static/video/alpha-source.mp4 video/alpha-source.mp4

for take in "${takes[@]}"; do
  if [ -d "dynamic/$take/frames/dream" ]; then
    mkdir -p "7-dreams/$take/frames"
    mv "dynamic/$take/frames/dream"/* "7-dreams/$take/frames/"
    echo "moved dynamic/$take/frames/dream/* -> 7-dreams/$take/frames/"
  fi
  # Everything else under dynamic/$take/ (video.mov, video.webm,
  # video-small.*, loop.mov, composite.mov, panel-dream.mov) is compose.ts's
  # old ffmpeg-compiled output for this take — not a Replicate call, so it's
  # cheap to regenerate and not worth migrating; the new compose() writes
  # fresh equivalents under 7-dreams/$take/ itself on its next run.
  rm -rf "dynamic/$take"
done

# Leftover abandoned background experiments + old compiled panel videos —
# not read by any current default path, kept for reference rather than
# deleted.
shopt -s nullglob
leftovers=(
  static/frames/background-masked-stepped
  static/frames/background-masked-tmix
  static/frames/background-shadow-test
  static/frames/background-soft
  static/frames/background-upscaled
  static/frames/background-zoned
  static/video/panel-*.mov
)
for f in "${leftovers[@]}"; do
  [ -e "$f" ] && move "$f" "legacy/$(basename "$f")"
done

# static/hero.jpg is the old job-root thumbnail — also ffmpeg-derived
# (a plain resize of the portrait panel's first frame, no Replicate call),
# regenerated fresh at the job root by the new compose().
rm -f static/hero.jpg

rmdir static/frames static/video static dynamic 2>/dev/null || true

echo "--- new layout ---"
find . -maxdepth 3 -type d | sort
