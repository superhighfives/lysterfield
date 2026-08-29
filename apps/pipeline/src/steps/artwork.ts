import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile, uploadFileOnce } from '../replicate.ts'

export interface ArtworkResult {
  framesDir: string
}

const STYLE_REFERENCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'resources',
  'style',
  'watercolor-reference.png'
)

const STYLE_PROMPT =
  "Repaint the first image entirely in the exact watercolor painting style of the second image: loose wet-on-wet washes, soft bleeding edges, visible paper texture, muted desaturated palette, painterly abstraction with no hard photographic detail. Keep the same composition and content as the first image, but the rendering technique, brushwork, and color treatment must match the second image's watercolor style precisely."

/**
 * Watercolor style transfer via `nano-banana-2` — see `models.ts` for why
 * this replaced DiffusionCLIP. Called once against the source frames for
 * the "artwork" panel, and again against the background-plate frames for
 * the "background" panel — pass a distinct `outputName` for each. The same
 * fixed style reference image is used for every frame/call, to keep the
 * style consistent across a scene rather than drifting per-frame.
 */
export async function artwork(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number
): Promise<ArtworkResult> {
  const outputDir = await framesDir(job, outputName)
  const styleReferenceUrl = await uploadFileOnce(STYLE_REFERENCE_PATH)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.nanoBanana2,
      {
        prompt: STYLE_PROMPT,
        image_input: [await readFileAsInput(inputPath), styleReferenceUrl],
        aspect_ratio: 'match_input_image',
        output_format: 'png',
      },
      outputPath
    )
  })

  return { framesDir: outputDir }
}
