import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface PortraitResult {
  framesDir: string
}

/**
 * Watercolor style transfer via our self-hosted DiffusionCLIP deployment —
 * see `models.ts` for why this replaced flux-kontext-dev/nano-banana-2.
 * Panel 2 ("portrait") only — panel 3 (background) used to run this a
 * second time on `background-plate.ts`'s output, but that produced severe
 * frame-to-frame flicker (DiffusionCLIP amplifying flux-fill-pro's small
 * per-frame fill differences); background-plate.ts now runs on this step's
 * own output instead and its result is panel 3's final frames directly —
 * see that file's docstring for the full story.
 *
 * No seed needed for temporal consistency across frames: `run.py`'s
 * inversion/sampling config (deterministic DDIM inversion, eta=0) never
 * injects fresh randomness per call, so similar consecutive video frames
 * already produce similarly-varying output on their own.
 */
export async function portrait(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number
): Promise<PortraitResult> {
  const outputDir = await framesDir(job, outputName)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.portrait,
      {
        image: await readFileAsInput(inputPath),
        n_test_step: 12,
      },
      outputPath,
      { jpegQuality: 90 }
    )
  })

  return { framesDir: outputDir }
}
