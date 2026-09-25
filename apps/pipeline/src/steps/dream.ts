import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { dynamicFramesDir, exists, listFrames, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface DreamResult {
  framesDir: string
}

export interface DreamOptions {
  /** Describes the reimagined look — the one creative choice that varies per take, so it's a caller-supplied prompt rather than a fixed constant like artwork.ts's. */
  prompt: string
  /** Name for this dream attempt — written to `dynamic/<take>/frames/dream/`, never overwriting another take. */
  take: string
  /** How many of the real per-second frames actually get regenerated; the rest hold the nearest one. Matches panel 3's stepped cadence (background-stabilize.ts) and the legacy Deforum dreaming lane's own ~10fps generation rate — a deliberate stop-motion look, not a cost-saving shortcut. */
  stepFps?: number
  concurrency?: number
  /** Fixed across every keyframe call so consecutive frames don't pick up unrelated color/composition drift from flux-kontext-dev's own random seed — same reasoning as background-plate.ts's fixed seed. */
  seed?: number
}

const DEFAULT_STEP_FPS = 6
const DEFAULT_SEED = 42

/**
 * `black-forest-labs/flux-kontext-dev`, once per kept frame — see
 * `models.ts` for why this replaced Kling. Checked against the real
 * Deforum output on the external drive: past the first handful of frames,
 * the legacy dreaming lane's `hybrid_composite` keeps the animation's
 * structure/layout locked to the real footage (a boardwalk stays a
 * boardwalk) while fully repainting it — this reproduces that by feeding
 * each *real* kept frame straight to an image-editing model with a
 * structure-preserving prompt, rather than generating from a single
 * start frame and letting a video model extrapolate motion on its own
 * (Kling's approach, and the reason it couldn't track real per-frame
 * content no matter the prompt).
 *
 * Only every `stepFps`-th frame is actually generated (a real Replicate
 * call); every frame in between holds that frame's output — same
 * held-cadence idea as `background-stabilize.ts`, but without motion-
 * compensated masking, since there's no cutout region here: the whole
 * frame is replaced, so a hard hold reads as the same deliberate
 * stepped/stop-motion look the legacy pipeline's own ~10fps dreaming
 * generation had, not a flaw to smooth over.
 */
export async function dream(job: Job, sourceFramesDir: string, opts: DreamOptions): Promise<DreamResult> {
  const stepFps = opts.stepFps ?? DEFAULT_STEP_FPS
  const concurrency = opts.concurrency ?? 4
  const seed = opts.seed ?? DEFAULT_SEED

  if (job.fps % stepFps !== 0) {
    throw new Error(`job.fps (${job.fps}) must be an exact multiple of stepFps (${stepFps})`)
  }
  const interval = job.fps / stepFps

  const outputDir = await dynamicFramesDir(job, opts.take, 'dream')
  const frames = await listFrames(sourceFramesDir)
  if (frames.length === 0) throw new Error(`No frames found in ${sourceFramesDir}`)

  const keyframeIndices: number[] = []
  for (let i = 0; i < frames.length; i += interval) keyframeIndices.push(i)

  let cursor = 0
  async function worker() {
    while (cursor < keyframeIndices.length) {
      const i = keyframeIndices[cursor++]
      const frame = frames[i]
      const outputPath = path.join(outputDir, frame)
      if (await exists(outputPath)) continue

      await runModelToFile(
        MODELS.dream,
        {
          input_image: await readFileAsInput(path.join(sourceFramesDir, frame)),
          prompt: opts.prompt,
          aspect_ratio: 'match_input_image',
          guidance: 2.5,
          seed,
        },
        outputPath,
        { jpegQuality: 90 }
      )
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  // Hold each keyframe's output across the rest of its window.
  for (const i of keyframeIndices) {
    const keyframeOutputPath = path.join(outputDir, frames[i])
    for (let j = i + 1; j < Math.min(i + interval, frames.length); j++) {
      const heldPath = path.join(outputDir, frames[j])
      if (!(await exists(heldPath))) {
        await copyFile(keyframeOutputPath, heldPath)
      }
    }
  }

  return { framesDir: outputDir }
}
