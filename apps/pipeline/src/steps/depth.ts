import { unlink } from 'node:fs/promises'
import sharp from 'sharp'
import { loadImageAndMaskRaw } from '../composite.ts'
import { forEachFrame, framesDir, siblingFramePath, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { runModelToFile } from '../replicate.ts'

export interface DepthResult {
  framesDir: string
}

const SIZE = 1024

/**
 * ZoeDepth, with the pre/post-processing `other.py` did around the raw
 * model call:
 *
 * Pre: composite the frame onto a transparent background using the matte's
 * alpha as the alpha channel (not white — masking everything except the
 * subject is intentional, matching the legacy `green` sub-step).
 *
 * Post: gamma-correct (matching `skimage.exposure.adjust_gamma(x, 1/2.2)`),
 * rescale intensity so only the top 235-255 brightness band survives,
 * stretched across the full 0-255 range (matching
 * `skimage.exposure.rescale_intensity(x, (235, 255))`) — this is what
 * gives the depth panel its high-contrast look — then re-apply the alpha
 * mask as a hard cutout on the model's actual output.
 *
 * That last step isn't redundant with the pre-composite above: ZoeDepth
 * occasionally hallucinates structure in the masked-out region anyway
 * (confirmed on `real-15s-60fps` frames 0250/0300 — faint grey wedges in
 * the bottom corners despite solid-black input there), so relying on the
 * model to respect a masked input isn't reliable. Forcing it back to black
 * post-hoc, driven by the same alpha used for the pre-mask, closes that
 * gap regardless of what the model does with the "empty" region — and
 * doesn't depend on which depth model is wired up (tried swapping to
 * `depth-anything-v2` for this same artifact; it didn't honor masked input
 * at all and instead hallucinated a whole-frame depth gradient across
 * every frame, not just occasionally — worse, not better, on this
 * specific failure mode. A post-mask fixes it regardless of model choice).
 */
export async function depth(
  job: Job,
  sourceFramesDir: string,
  alphaFramesDir: string,
  concurrency: number
): Promise<DepthResult> {
  const outputDir = await framesDir(job, '5-depth/frames')

  await forEachFrame(sourceFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    const alphaPath = await siblingFramePath(inputPath, alphaFramesDir)
    const { png: compositePng, alpha } = await compositeOnTransparent(inputPath, alphaPath)

    const modelOutputPath = `${outputPath}.model.png`
    await runModelToFile(
      MODELS.zoedepth,
      { image: new File([new Uint8Array(compositePng)], 'frame.png') },
      modelOutputPath
    )

    await gammaRescaleAndMask(modelOutputPath, alpha, outputPath)
    await unlink(modelOutputPath)
  })

  return { framesDir: outputDir }
}

async function compositeOnTransparent(
  imagePath: string,
  maskPath: string
): Promise<{ png: Buffer; alpha: Buffer }> {
  const { rgb, alpha } = await loadImageAndMaskRaw(imagePath, maskPath, SIZE)

  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = alpha[i]
  }

  const png = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer()
  return { png, alpha }
}

/** `alpha` is the same `SIZE`x`SIZE` greyscale mask used to build the model's input — see the `depth()` docstring for why it's re-applied here too. */
async function gammaRescaleAndMask(inputPath: string, alpha: Buffer, outputPath: string): Promise<void> {
  const image = sharp(inputPath)
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })

  const gamma = 1.0 / 2.2
  const [low, high] = [235, 255]
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const gammaCorrected = 255 * (v / 255) ** gamma
    const clipped = Math.min(Math.max(gammaCorrected, low), high)
    lut[v] = Math.round(((clipped - low) / (high - low)) * 255)
  }

  // `alpha` has one entry per pixel; `data` is channel-interleaved (sharp's
  // raw buffer layout), so each byte's pixel is `i / info.channels`.
  for (let i = 0; i < data.length; i++) {
    const pixel = Math.floor(i / info.channels)
    data[i] = Math.round((lut[data[i]] * alpha[pixel]) / 255)
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .jpeg({ quality: 90 })
    .toFile(outputPath)
}
