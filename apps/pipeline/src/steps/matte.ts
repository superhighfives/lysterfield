import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { exists, extractFrames, framesDir, hasFiles, listFrames, videoPath, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface MatteResult {
  /** The alpha-mask video downloaded from Replicate. */
  alphaVideoPath: string
  /** Per-frame grayscale alpha mattes, same naming/fps as the source frames. */
  alphaFramesDir: string
  /** Frames whose mask disagreed sharply with its temporal neighbors and got replaced, for logging. */
  repairs: { frame: string; replacedWith: string }[]
}

/**
 * Robust Video Matting (arielreplicate/robust_video_matting) — one call for
 * the whole cropped video, not per-frame. `output_type: "alpha-mask"`
 * (the model's default, "green-screen", is wrong for this pipeline).
 */
export async function matte(job: Job, croppedVideoPath: string): Promise<MatteResult> {
  const alphaVideoPath = await videoPath(job, 'video/alpha-source', 'mp4')
  if (!(await exists(alphaVideoPath))) {
    await runModelToFile(
      MODELS.robustVideoMatting,
      {
        input_video: await readFileAsInput(croppedVideoPath),
        output_type: 'alpha-mask',
      },
      alphaVideoPath
    )
  }

  const alphaFramesDir = await framesDir(job, 'alpha')
  let repairs: { frame: string; replacedWith: string }[] = []
  if (!(await hasFiles(alphaFramesDir))) {
    await extractFrames(alphaVideoPath, alphaFramesDir, job.fps)
    repairs = await repairGlitchedFrames(alphaFramesDir)
  }

  return { alphaVideoPath, alphaFramesDir, repairs }
}

const SCAN_SIZE = 192
const WINDOW = 2

/**
 * RVM occasionally glitches for a frame or two — not a boundary wobble
 * from real motion (which stays localized to the part that's actually
 * moving), but a uniform shrink/distortion of the *entire* silhouette
 * outline all at once. Confirmed on `real-15s-60fps` frames 0227-0233: a
 * visualized diff against neighboring frames showed a consistent ring of
 * disagreement all the way around the figure (head, both shoulders, both
 * sides), not a one-sided patch the way a turning head or moving arm
 * would produce. That full-outline signature is what this detects:
 * for each frame, the fraction of pixels that disagree with a majority
 * vote of its `WINDOW` nearest neighbors on each side. Real motion changes
 * a minority of that vote too, so the threshold below is calibrated well
 * above the real-footage baseline (mean ~0.005, stddev ~0.003 on the
 * reference clip), not a hair-trigger on normal movement.
 *
 * Fix: hold the nearest clean neighbor's frame instead of the glitched
 * one — same repair strategy as `background-stabilize.ts`'s leak repair,
 * and good enough for a glitch that only lasts a second or two.
 */
export async function repairGlitchedFrames(alphaFramesDir: string): Promise<{ frame: string; replacedWith: string }[]> {
  const frames = await listFrames(alphaFramesDir)
  if (frames.length < WINDOW * 2 + 1) return []

  const masks = await Promise.all(
    frames.map(async (frame) => {
      const { data } = await sharp(path.join(alphaFramesDir, frame))
        .resize(SCAN_SIZE, SCAN_SIZE)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const bin = new Uint8Array(SCAN_SIZE * SCAN_SIZE)
      for (let i = 0; i < data.length; i++) bin[i] = data[i] > 128 ? 1 : 0
      return bin
    })
  )

  const disagreement = masks.map((mask, i) => {
    const lo = Math.max(0, i - WINDOW)
    const hi = Math.min(masks.length - 1, i + WINDOW)
    let disagree = 0
    let total = 0
    for (let p = 0; p < SCAN_SIZE * SCAN_SIZE; p++) {
      let sum = 0
      let count = 0
      for (let j = lo; j <= hi; j++) {
        if (j === i) continue
        sum += masks[j][p]
        count++
      }
      if ((sum / count >= 0.5 ? 1 : 0) !== mask[p]) disagree++
      total++
    }
    return disagree / total
  })

  const mean = disagreement.reduce((a, b) => a + b, 0) / disagreement.length
  const variance = disagreement.reduce((a, b) => a + (b - mean) ** 2, 0) / disagreement.length
  const threshold = Math.max(0.01, mean + 2.5 * Math.sqrt(variance))

  const flagged = new Set(disagreement.map((d, i) => (d > threshold ? i : -1)).filter((i) => i >= 0))
  const repairs: { frame: string; replacedWith: string }[] = []

  for (const i of flagged) {
    let replacement = -1
    for (let d = 1; d < frames.length; d++) {
      const candidates = [i - d, i + d].filter((c) => c >= 0 && c < frames.length && !flagged.has(c))
      if (candidates.length > 0) {
        replacement = candidates[0]
        break
      }
    }
    if (replacement === -1) continue
    await copyFile(path.join(alphaFramesDir, frames[replacement]), path.join(alphaFramesDir, frames[i]))
    repairs.push({ frame: frames[i], replacedWith: frames[replacement] })
  }

  return repairs
}
