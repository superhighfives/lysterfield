import sharp from 'sharp'
import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { runModelToFile } from '../replicate.ts'

export interface OutlineResult {
  framesDir: string
}

const SIZE = 1024

/**
 * The packaged ArtLine Cog model (`models/outline/`, phase 2), with the
 * pre/post-processing `other.py` did around the raw model call:
 *
 * Pre: matte-cutout the source frame onto white (not transparent — this is
 * "erase everything outside the subject", same as the legacy `paste(...,
 * mask=alpha)` onto a white canvas), then soft-light blend that with the
 * matching depth-panel frame at 50% opacity, then brighten ×1.4 (legacy
 * also set contrast ×1.0 — a no-op, not ported). The model itself
 * (`predict.py`) handles resizing to its 300×300 input size and rendering/
 * resizing the 1024×1024 grayscale output — nothing to do here after the
 * call.
 */
export async function outline(
  job: Job,
  sourceFramesDir: string,
  alphaFramesDir: string,
  depthFramesDir: string,
  concurrency: number
): Promise<OutlineResult> {
  const outputDir = await framesDir(job, 'outline')

  await forEachFrame(sourceFramesDir, outputDir, concurrency, async (inputPath, outputPath) => {
    const alphaPath = inputPath.replace(sourceFramesDir, alphaFramesDir)
    const depthPath = inputPath.replace(sourceFramesDir, depthFramesDir)

    const cutout = await compositeOnWhite(inputPath, alphaPath)
    const blended = await softLightBlend(cutout, depthPath, 0.5)
    const brightened = await brighten(blended, 1.4)

    await runModelToFile(
      MODELS.outline,
      { image: new File([new Uint8Array(brightened)], 'frame.png') },
      outputPath
    )
  })

  return { framesDir: outputDir }
}

/** Pastes `imagePath` onto a white SIZE×SIZE canvas using `maskPath` as the alpha. */
async function compositeOnWhite(imagePath: string, maskPath: string): Promise<Buffer> {
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

  const out = Buffer.alloc(SIZE * SIZE * 3)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = alpha[i] / 255
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = Math.round(rgb[i * 3 + c] * a + 255 * (1 - a))
    }
  }

  return sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer()
}

/** W3C soft-light formula (matches Python's `blend_modes.soft_light`), per channel, 0-1 normalized. */
function softLight(base: number, blend: number): number {
  if (blend <= 0.5) return base - (1 - 2 * blend) * base * (1 - base)
  const d = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base)
  return base + (2 * blend - 1) * (d - base)
}

/** Soft-light blends `basePng` with the image at `overlayPath`, linearly interpolated by `opacity`. */
async function softLightBlend(basePng: Buffer, overlayPath: string, opacity: number): Promise<Buffer> {
  const { data: base, info } = await sharp(basePng).raw().toBuffer({ resolveWithObject: true })
  const { data: overlay } = await sharp(overlayPath)
    .resize(info.width, info.height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const out = Buffer.alloc(base.length)
  for (let i = 0; i < base.length; i++) {
    const b = base[i] / 255
    const l = overlay[i] / 255
    const comp = softLight(b, l)
    out[i] = Math.round((comp * opacity + b * (1 - opacity)) * 255)
  }

  return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer()
}

/** Multiplies every pixel by `factor`, clipped to 255 — matches PIL's `ImageEnhance.Brightness`. */
async function brighten(png: Buffer, factor: number): Promise<Buffer> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.min(255, Math.round(data[i] * factor))
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer()
}
