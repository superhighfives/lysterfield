import { firstFrame, videoPath, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface DreamResult {
  videoPath: string
}

export interface DreamOptions {
  /** The scene's real generation prompt — not `dreams.json`'s display caption. */
  prompt: string
  /** Style/colour reference image (the modern equivalent of Deforum's `colormatch_image`). */
  styleRefPath: string
  /** Source frame to animate from. Defaults to the job's first `frames/source/` frame. */
  framePath?: string
}

/**
 * Kling 3.0 Omni — one call per scene, replacing the entire legacy dreaming
 * lane (Deforum run frame-by-frame on a local GPU, manual bad-frame
 * curation, RIFE/Enhancr gap-fill, `generate-dreaming.sh`'s minterpolate
 * step). Picked over Grok Imagine in phase 2: `start_image` diffuses the
 * real source frame into painted style, the same thing Deforum's own
 * `use_init`/`strength`/`hybrid_composite` settings show it was actually
 * doing — Grok's reference_images are explicitly "not starting frames," a
 * looser match. Params match what phase 2 already validated; no
 * frame-rate/resize normalization here, that's compose.ts's job (phase 4).
 */
export async function dream(job: Job, opts: DreamOptions): Promise<DreamResult> {
  const outputPath = await videoPath(job, 'dream', 'mp4')
  const framePath = opts.framePath ?? (await firstFrame(`${job.dir}/frames/source`))

  await runModelToFile(
    MODELS.dream,
    {
      prompt: opts.prompt,
      start_image: await readFileAsInput(framePath),
      reference_images: [await readFileAsInput(opts.styleRefPath)],
      duration: 5,
      mode: 'standard',
      aspect_ratio: '16:9',
      generate_audio: false,
    },
    outputPath
  )

  return { videoPath: outputPath }
}
