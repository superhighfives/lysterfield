import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface ArtworkResult {
  framesDir: string
}

const STYLE_PROMPT =
  'Repaint this photo entirely as a loose watercolor painting: wet-on-wet washes, soft bleeding edges, visible paper texture, muted desaturated palette, painterly abstraction with no hard photographic detail, in the style of a hand-painted watercolor landscape/portrait. Keep the same composition, content, and identity as the original — only the rendering technique changes.'

/**
 * Watercolor style transfer via `flux-kontext-dev` — see `models.ts` for
 * why this replaced nano-banana-2. Called once against the source frames
 * for the "artwork" panel, and again against the background-plate frames
 * for the "background" panel — pass a distinct `outputName` for each.
 * Unlike nano-banana-2, no separate style-reference image is needed —
 * kontext-dev reliably preserves the input's identity/composition while
 * applying the style purely from the prompt.
 */
export async function artwork(
  job: Job,
  inputFramesDir: string,
  outputName: string,
  concurrency: number,
  seed?: number
): Promise<ArtworkResult> {
  const outputDir = await framesDir(job, outputName)

  await forEachFrame(inputFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    await runModelToFile(
      MODELS.artwork,
      {
        prompt: STYLE_PROMPT,
        input_image: await readFileAsInput(inputPath),
        aspect_ratio: 'match_input_image',
        output_format: 'png',
        ...(seed === undefined ? {} : { seed }),
      },
      outputPath
    )
  })

  return { framesDir: outputDir }
}
