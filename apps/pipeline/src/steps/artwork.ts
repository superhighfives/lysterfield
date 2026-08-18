import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface ArtworkResult {
  framesDir: string
}

/**
 * DiffusionCLIP watercolor style transfer (`main.py`/`background.py` in the
 * legacy pipeline were byte-identical — the only difference was which frame
 * folder they were pointed at). Called once against the source frames for
 * the "artwork" panel, and again against the background-plate frames for
 * the "background" panel — pass a distinct `outputName` for each.
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
      MODELS.diffusionclip,
      {
        image: await readFileAsInput(inputPath),
        edit_type: 'ImageNet style transfer - Watercolor art',
        n_test_step: 12,
      },
      outputPath
    )
  })

  return { framesDir: outputDir }
}
