import sharp from 'sharp'

/**
 * flux-fill-pro occasionally reconstructs the erased person instead of
 * replacing them — a real, known failure mode (see mask.ts's history) that
 * became somewhat more likely once `background-plate.ts` dropped its
 * `guidance` value for a softer style. Detected here with a free, local,
 * zero-API-cost heuristic rather than another model call: find the alpha
 * mask's bounding box, take its top 22% (the head/neck zone), and measure
 * what fraction of pixels there fall in a skin-tone color range. Checking
 * the whole mask region (not just the head zone) false-positived heavily on
 * wooden boardwalk planks in testing — restricting to the head zone fixed
 * that. Confirmed on real footage: leaks scored 11.8–69.8%, clean frames
 * topped out at 6.8% — see
 * plans/in-progress/panel-3-background-flicker-mitigation.md.
 */
export const LEAK_SCORE_THRESHOLD = 0.1

export interface LeakScore {
  /** Frame filename (matches the alpha/fill directory's naming), e.g. "0202.png". */
  frame: string
  /** Fraction of head-zone pixels classified as skin-toned, 0-1. */
  ratio: number
}

function isSkin(r: number, g: number, b: number): boolean {
  const maxc = Math.max(r, g, b)
  const minc = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && maxc - minc > 15 && Math.abs(r - g) > 15 && r > g && r > b
}

/**
 * Scores one already-generated fill frame against its alpha mask for
 * likely person-leakage. Higher = more likely a leak. The alpha mask is
 * typically at a different (larger) resolution than the fill frame — e.g.
 * the source crop's resolution vs. `compose.ts`'s `PANEL_SIZE` — so it's
 * resized to match the fill before comparing; comparing them at their
 * native resolutions silently misaligns every pixel lookup and made this
 * detect nothing on real leaked frames when first written.
 */
export async function scoreLeak(fillPath: string, alphaPath: string): Promise<number> {
  const fill = await sharp(fillPath).raw().toBuffer({ resolveWithObject: true })
  const { width, height } = fill.info
  const alpha = await sharp(alphaPath).resize(width, height).greyscale().raw().toBuffer({ resolveWithObject: true })
  const fillData = fill.data
  const alphaData = alpha.data
  const fillChannels = fill.info.channels
  const alphaChannels = alpha.info.channels

  let minY = height,
    maxY = 0,
    minX = width,
    maxX = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaData[(y * width + x) * alphaChannels] > 128) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxY < minY) return 0

  const boxHeight = maxY - minY
  const headBottom = minY + Math.round(boxHeight * 0.22)
  const insetX = Math.round((maxX - minX) * 0.15)
  const xStart = minX + insetX
  const xEnd = maxX - insetX

  let skin = 0
  let total = 0
  for (let y = minY; y < headBottom; y++) {
    for (let x = xStart; x < xEnd; x++) {
      if (alphaData[(y * width + x) * alphaChannels] > 128) {
        total++
        const idx = (y * width + x) * fillChannels
        if (isSkin(fillData[idx], fillData[idx + 1], fillData[idx + 2])) skin++
      }
    }
  }
  return total > 0 ? skin / total : 0
}

/** Scores every (fillPath, alphaPath) pair and returns only those over the leak threshold, worst first. */
export async function detectLeaks(
  frames: { frame: string; fillPath: string; alphaPath: string }[]
): Promise<LeakScore[]> {
  const scored = await Promise.all(
    frames.map(async ({ frame, fillPath, alphaPath }) => ({
      frame,
      ratio: await scoreLeak(fillPath, alphaPath),
    }))
  )
  return scored.filter((s) => s.ratio > LEAK_SCORE_THRESHOLD).sort((a, b) => b.ratio - a.ratio)
}
