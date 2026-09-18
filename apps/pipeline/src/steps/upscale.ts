import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface UpscaleResult {
  framesDir: string
}

/**
 * Real-ESRGAN. The legacy pipeline pinned a named preset
 * (`version: "General - RealESRGANplus"`) that no longer exists on the live
 * model — replaced by a numeric `upscale` factor. Default is `2`, not `4`:
 * artwork/background frames are 512px, and compose.ts's `PANEL_SIZE` is
 * 1024 — a 4x factor produced 2048px frames that `compose` immediately
 * downsampled back to 1024, quadrupling both Replicate cost and on-disk
 * size for pixels nobody ever saw. Called once against the artwork frames
 * and again against the background-artwork frames — pass a distinct
 * `outputName` for each, same shape as `artwork()`.
 */
export async function upscale(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number,
  upscaleFactor = 2
): Promise<UpscaleResult> {
  const outputDir = await framesDir(job, outputName)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.realEsrgan,
      {
        image: await readFileAsInput(inputPath),
        upscale: upscaleFactor,
      },
      outputPath,
      { jpegQuality: 90 }
    )
  })

  return { framesDir: outputDir }
}
