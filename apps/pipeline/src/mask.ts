import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Growing/feathering the mask well past the matte's precise silhouette.
 * flux-fill-pro at max guidance still reconstructed a person on ~30% of a
 * 20-frame sample (see models.ts) when given the exact person-shaped alpha
 * mask — the shape itself, not just prompt weight, was pulling the model
 * toward "there's a person here". A same-model retest on those exact
 * failure frames plus 8 fresh ones (11/11 clean) confirmed a heavily
 * dilated + blurred mask — which no longer reads as a person silhouette —
 * removes that pull. See `background-plate.ts` for the fuller history.
 */
export const MASK_DILATION_PASSES = 100
export const MASK_BLUR_SIGMA = 30

/** Dilates and blurs `alphaPath`'s silhouette into a soft, oversized fill mask at `outputPath`. */
export async function reshapeMask(alphaPath: string, outputPath: string): Promise<void> {
  const dilations = Array(MASK_DILATION_PASSES).fill('dilation').join(',')
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    alphaPath,
    '-vf',
    `format=gray,${dilations},gblur=sigma=${MASK_BLUR_SIGMA}`,
    outputPath,
  ])
}
