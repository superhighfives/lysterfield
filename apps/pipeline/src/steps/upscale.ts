import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface UpscaleResult {
  framesDir: string
}

/**
 * Real-ESRGAN. The legacy pipeline pinned a named preset
 * (`version: "General - RealESRGANplus"`) that no longer exists on the live
 * model — replaced by a numeric `upscale` factor, default `4` (see the
 * phase 3 plan's open questions: worth a visual check against an old
 * upscaled frame before treating `4` as final). Called once against the
 * artwork frames and again against the background-artwork frames — pass a
 * distinct `outputName` for each, same shape as `artwork()`.
 */
export async function upscale(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number,
  upscaleFactor = 4
): Promise<UpscaleResult> {
  const outputDir = await framesDir(job, outputName)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.realEsrgan,
      {
        image: await readFileAsInput(inputPath),
        upscale: upscaleFactor,
      },
      outputPath
    )
  })

  return { framesDir: outputDir }
}
