import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface ArtworkResult {
  framesDir: string
}

/**
 * Watercolor style transfer via our self-hosted DiffusionCLIP deployment —
 * see `models.ts` for why this replaced flux-kontext-dev/nano-banana-2.
 * Called once against the source frames for the "artwork" panel, and
 * again against the background-plate frames for the "background" panel —
 * pass a distinct `outputName` for each.
 *
 * No seed needed for temporal consistency across frames: `run.py`'s
 * inversion/sampling config (deterministic DDIM inversion, eta=0) never
 * injects fresh randomness per call, so similar consecutive video frames
 * already produce similarly-varying output on their own.
 */
export async function artwork(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number
): Promise<ArtworkResult> {
  const outputDir = await framesDir(job, outputName)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.artwork,
      {
        image: await readFileAsInput(inputPath),
        n_test_step: 12,
      },
      outputPath
    )
  })

  return { framesDir: outputDir }
}
