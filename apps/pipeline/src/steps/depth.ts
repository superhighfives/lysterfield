import { unlink } from 'node:fs/promises'
import sharp from 'sharp'
import { forEachFrame, framesDir, type Job } from '../job.ts'
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
 * then rescale intensity so only the top 235-255 brightness band survives,
 * stretched across the full 0-255 range (matching
 * `skimage.exposure.rescale_intensity(x, (235, 255))`) — this is what
 * gives the depth panel its high-contrast look.
 */
export async function depth(
  job: Job,
  sourceFramesDir: string,
  alphaFramesDir: string,
  concurrency: number
): Promise<DepthResult> {
  const outputDir = await framesDir(job, 'depth')

  await forEachFrame(sourceFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    const alphaPath = inputPath.replace(sourceFramesDir, alphaFramesDir)
    const compositePng = await compositeOnTransparent(inputPath, alphaPath)

    const modelOutputPath = `${outputPath}.model.png`
    await runModelToFile(
      MODELS.zoedepth,
      { image: new File([new Uint8Array(compositePng)], 'frame.png') },
      modelOutputPath
    )

    await gammaAndRescale(modelOutputPath, outputPath)
    await unlink(modelOutputPath)
  })

  return { framesDir: outputDir }
}

async function compositeOnTransparent(imagePath: string, maskPath: string): Promise<Buffer> {
  const { data: rgb } = await sharp(imagePath)
    .resize(SIZE, SIZE)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { data: alpha } = await sharp(maskPath)
    .resize(SIZE, SIZE)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = alpha[i]
  }

  return sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer()
}

async function gammaAndRescale(inputPath: string, outputPath: string): Promise<void> {
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

  for (let i = 0; i < data.length; i++) {
    data[i] = lut[data[i]]
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toFile(outputPath)
}
