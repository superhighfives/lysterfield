import path from 'node:path'
import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface BackgroundPlateResult {
  /** Per-frame stills with the subject erased. */
  plateFramesDir: string
}

/**
 * Erases the subject from each frame, driven by the matte's alpha frames
 * instead of the legacy pipeline's manual click-to-select SAM step
 * (`pc-settings/script.sh`).
 *
 * Originally implemented against `jd7h/propainter` (a temporally-consistent
 * *video* object-removal model) to avoid frame-to-frame flicker — but that
 * model's Cog wrapper fails its own mask-extension validation against every
 * Replicate-hosted file URL we could produce (`mask.suffix` check in its
 * `predict.py`; reproduced with clean, freshly-uploaded `.mp4`/`.png` URLs
 * via a raw API call, so it's a bug in that model, not our upload). Falls
 * back to per-frame `allenhooo/lama` (image + mask) as the phase 3 spec
 * anticipated — real flicker risk between frames, not yet evaluated across
 * a full clip.
 */
export async function backgroundPlate(
  job: Job,
  sourceFramesDir: string,
  alphaFramesDir: string,
  concurrency: number
): Promise<BackgroundPlateResult> {
  const plateFramesDir = await framesDir(job, 'background-plate')

  await forEachFrame(sourceFramesDir, plateFramesDir, concurrency, async (inputPath, outputPath) => {
    const alphaPath = path.join(alphaFramesDir, path.basename(inputPath))
    await runModelToFile(
      MODELS.lama,
      {
        image: await readFileAsInput(inputPath),
        mask: await readFileAsInput(alphaPath),
      },
      outputPath
    )
  })

  return { plateFramesDir }
}
