import sharp from 'sharp'
import { loadImageAndMaskRaw } from '../composite.ts'
import { forEachFrame, framesDir, siblingFramePath, type Job } from '../job.ts'
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
 * matching depth-panel frame at 50% opacity. The model itself
 * (`predict.py`) handles resizing to its 300×300 input size and rendering/
 * resizing the 1024×1024 grayscale output — nothing to do here after the
 * call.
 *
 * `other.py`'s remaining step — brighten ×1.4 (legacy also set contrast
 * ×1.0, a no-op, not ported) — is NOT ported as a blind multiply. On
 * well-lit real footage (bright sky, light-coloured clothing) that
 * blindly blows already-bright pixels straight to 255: found live on a
 * real clip where the shirt/torso region came back from the model as a
 * blank void with no linework at all, because the "brightened" input sharp
 * fed it had already clipped every fold and seam to flat white — confirmed
 * by checking the actual pixel stats (mean ~245/255) before assuming the
 * model itself was at fault. See `contrastStretchPersonPixels` for the fix.
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
    const alphaPath = await siblingFramePath(inputPath, alphaFramesDir)
    const depthPath = await siblingFramePath(inputPath, depthFramesDir)

    const cutout = await compositeOnWhite(inputPath, alphaPath)
    const blended = await softLightBlend(cutout, depthPath, 0.5)

    await runModelToFile(
      MODELS.outline,
      { image: new File([new Uint8Array(blended)], 'frame.png') },
      outputPath,
      { jpegQuality: 90 }
    )
  })

  return { framesDir: outputDir }
}

/** Middle 96% (2nd-98th percentile) of person pixels stretched to fill 0-255. */
const STRETCH_LOW_PERCENTILE = 0.02
const STRETCH_HIGH_PERCENTILE = 0.98

/**
 * Pastes `imagePath` onto a white SIZE×SIZE canvas using `maskPath` as the
 * alpha, after first contrast-stretching the subject's own pixels (not a
 * blind brightness multiply — see this file's top comment). Computing the
 * stretch's low/high bounds only from pixels *inside* the person mask
 * matters: doing it after pasting onto white (or via a naive whole-frame
 * auto-levels) sees a canvas that's already 0-255 just from the white
 * padding, so there's nothing left to stretch and the subject's actual
 * compressed midtones never get spread back out.
 */
async function compositeOnWhite(imagePath: string, maskPath: string): Promise<Buffer> {
  const { rgb, alpha } = await loadImageAndMaskRaw(imagePath, maskPath, SIZE)

  const personValues: number[] = []
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (alpha[i] > 128) personValues.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
  }
  personValues.sort((a, b) => a - b)
  const lo = personValues[Math.floor(personValues.length * STRETCH_LOW_PERCENTILE)] ?? 0
  const hi = personValues[Math.floor(personValues.length * STRETCH_HIGH_PERCENTILE)] ?? 255
  const range = Math.max(1, hi - lo) // avoid divide-by-zero on a near-flat-colour subject

  const out = Buffer.alloc(SIZE * SIZE * 3)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = alpha[i] / 255
    for (let c = 0; c < 3; c++) {
      const stretched = Math.max(0, Math.min(255, ((rgb[i * 3 + c] - lo) / range) * 255))
      out[i * 3 + c] = Math.round(stretched * a + 255 * (1 - a))
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
