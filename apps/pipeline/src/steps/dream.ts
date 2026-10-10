import { copyFile, link, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exists, framesDir, listFrames, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface DreamResult {
  framesDir: string
}

export interface DreamOptions {
  /** Describes the reimagined look — the one creative choice that varies per take, so it's a caller-supplied prompt rather than a fixed constant like artwork.ts's. `NO_PEOPLE_SUFFIX` is always appended on top of this — never rely on this prompt alone to keep people out. */
  prompt: string
  /** Name for this dream attempt — written to `7-dreams/<take>/frames/`, never overwriting another take. */
  take: string
  /** How many of the real per-second frames actually get regenerated; the rest hold the nearest one. Matches panel 3's stepped cadence (background-stabilize.ts) and the legacy Deforum dreaming lane's own ~10fps generation rate — a deliberate stop-motion look, not a cost-saving shortcut. */
  stepFps?: number
  concurrency?: number
  /** Fixed across every keyframe call so consecutive frames don't pick up unrelated color/composition drift from flux-kontext-dev's own random seed — same reasoning as background-plate.ts's fixed seed. */
  seed?: number
}

/** A take's settings, saved to `7-dreams/<take>/take.json` so the take always remembers what made it. */
export interface TakeConfig {
  prompt: string
  seed: number
  stepFps: number
}

const DEFAULT_STEP_FPS = 6
const DEFAULT_SEED = 42

function takePath(job: Job, take: string): string {
  return path.join(job.dir, '7-dreams', take, 'take.json')
}

/** Reads a take's saved settings, or undefined for a take that hasn't been started. */
export async function loadTake(job: Job, take: string): Promise<TakeConfig | undefined> {
  if (!(await exists(takePath(job, take)))) return undefined
  return JSON.parse(await readFile(takePath(job, take), 'utf8'))
}

/**
 * Always appended to the caller-supplied prompt, never left to the caller
 * to remember — both `dream-styletransfer-v2` and `dream-styletransfer-
 * v2-fixed` in `real-15s-60fps` came back showing a recognisable person
 * because the per-take prompt alone didn't hold the line. Panel 7 must
 * always read as an abstract repainting of the scene's shapes/light/colour,
 * never a person, no matter what creative direction a take's own prompt
 * asks for.
 */
const NO_PEOPLE_SUFFIX =
  " Abstract painterly reinterpretation of the scene's shapes, light, and colour only — dissolve any person, face, or human figure completely into brushwork, texture, and form indistinguishable from the rest of the scene. Never depict a recognisable person or body."

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

  const outputDir = await framesDir(job, `7-dreams/${opts.take}/frames`)
  const saved = await loadTake(job, opts.take)
  if (saved && (saved.prompt !== opts.prompt || saved.seed !== seed || saved.stepFps !== stepFps) && (await listFrames(outputDir)).length > 0) {
    throw new Error(
      `Take "${opts.take}" already has frames made with different settings (${JSON.stringify(saved)}) — use a new --take name rather than mixing two looks in one take.`
    )
  }
  await writeFile(takePath(job, opts.take), `${JSON.stringify({ prompt: opts.prompt, seed, stepFps } satisfies TakeConfig, null, 2)}\n`)

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
          prompt: opts.prompt + NO_PEOPLE_SUFFIX,
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

  // Hold each keyframe's output across the rest of its window. Held frames
  // are hard links, not copies: the frame sequence stays complete for
  // compose, but only the keyframes take up disk space. A link shares the
  // keyframe's file, so replace a keyframe (delete + rewrite) rather than
  // editing it in place, or its held frames change with it.
  for (const i of keyframeIndices) {
    const keyframeOutputPath = path.join(outputDir, frames[i])
    for (let j = i + 1; j < Math.min(i + interval, frames.length); j++) {
      const heldPath = path.join(outputDir, frames[j])
      if (!(await exists(heldPath))) {
        await link(keyframeOutputPath, heldPath).catch((error: NodeJS.ErrnoException) => {
          // Hard links can't cross filesystems; copy only in that case.
          if (error.code !== 'EXDEV') throw error
          return copyFile(keyframeOutputPath, heldPath)
        })
      }
    }
  }

  return { framesDir: outputDir }
}
